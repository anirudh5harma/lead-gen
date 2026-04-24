import { NextResponse } from 'next/server'
import { createAdminClient, createServiceClient } from '@/lib/supabase/server'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import { getPlanLimits, type PlanTier } from '@/lib/plan'
import { resolveLeadQuotaDecision } from '@/lib/lead-quota'
import { computeDeliveryAllowance, nextQuotaRetryAt } from '@/lib/lead-delivery'
import { recordLeadOverage } from '@/lib/dodo'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { sendSlackAlert } from '@/lib/slack'
import { sendFirstLeadEmail } from '@/lib/resend'
import { buildFeedbackMaps, sortQueueRowsByFeedback, getFeedbackWindowStart } from '@/lib/ranking-feedback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DUE_QUEUE_LIMIT = 1200

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  return runDelivery(request)
}

export async function POST(request: Request) {
  return runDelivery(request)
}

async function runDelivery(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'deliver_leads')

  try {
    const nowIso = new Date().toISOString()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: expiredRows, error: expireError } = await supabase
      .from('lead_delivery_queue')
      .update({
        queue_status: 'expired',
        last_attempted_at: nowIso,
      })
      .eq('queue_status', 'pending')
      .lt('expires_at', nowIso)
      .select('id')

    if (expireError) {
      console.error('[deliver-leads] queue expiry error:', expireError.message)
    }

    const { data: dueRows, error: queueError } = await supabase
      .from('lead_delivery_queue')
      .select(`
        id,
        user_id,
        client_id,
        signal_id,
        target_company,
        company_domain,
        relevance_score,
        relevance_reason,
        priority_score,
        dedupe_key,
        source_name,
        match_debug,
        queue_status,
        next_delivery_at,
        attempt_count,
        signals(signal_type, headline, summary)
      `)
      .eq('queue_status', 'pending')
      .lte('next_delivery_at', nowIso)
      .order('priority_score', { ascending: false })
      .order('queued_at', { ascending: true })
      .limit(DUE_QUEUE_LIMIT)

    if (queueError) {
      throw new Error(queueError.message)
    }

    if (!dueRows?.length) {
      const payload = {
        delivered: 0,
        expired: expiredRows?.length ?? 0,
        reason: 'No due queue rows',
      }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const userIds = [...new Set(dueRows.map(row => row.user_id))]
    const clientIds = [...new Set(dueRows.map(row => row.client_id))]
    const [userSettingsRows, recentUnlockedRows, recentDeliveredRows, feedbackLeadRows, existingLeadRows] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id, plan, allow_lead_overage, slack_webhook_url')
        .in('user_id', userIds),
      supabase
        .from('leads')
        .select('user_id')
        .eq('is_unlocked', true)
        .gte('unlocked_at', thirtyDaysAgo)
        .in('user_id', userIds),
      supabase
        .from('leads')
        .select('user_id')
        .gte('created_at', oneDayAgo)
        .in('user_id', userIds),
      supabase
        .from('leads')
        .select('client_id, target_company, company_domain, status, is_unlocked, created_at, unlocked_at, sent_at, replied_at, booked_at, signals(signal_type, source_name)')
        .in('client_id', clientIds)
        .gte('created_at', getFeedbackWindowStart()),
      supabase
        .from('leads')
        .select('user_id')
        .in('user_id', userIds),
    ])
    const feedbackMaps = buildFeedbackMaps((feedbackLeadRows.data ?? []) as Array<{
      client_id: string | null
      target_company: string
      company_domain?: string | null
      status: string
      is_unlocked?: boolean | null
      created_at?: string | null
      unlocked_at?: string | null
      sent_at?: string | null
      replied_at?: string | null
      booked_at?: string | null
      signals?: { signal_type?: string | null; source_name?: string | null } | Array<{ signal_type?: string | null; source_name?: string | null }> | null
    }>)

    const userSettingsMap = new Map<string, {
      plan: PlanTier
      allowLeadOverage: boolean
      slackWebhookUrl: string | null
    }>()
    for (const row of (userSettingsRows.data ?? [])) {
      userSettingsMap.set(row.user_id, {
        plan: (row.plan ?? 'free') as PlanTier,
        allowLeadOverage: row.allow_lead_overage ?? false,
        slackWebhookUrl: row.slack_webhook_url ?? null,
      })
    }

    const unlockedUsage = new Map<string, number>()
    for (const row of (recentUnlockedRows.data ?? [])) {
      unlockedUsage.set(row.user_id, (unlockedUsage.get(row.user_id) ?? 0) + 1)
    }

    const deliveredLast24h = new Map<string, number>()
    for (const row of (recentDeliveredRows.data ?? [])) {
      deliveredLast24h.set(row.user_id, (deliveredLast24h.get(row.user_id) ?? 0) + 1)
    }

    const usersWithAnyLead = new Set((existingLeadRows.data ?? []).map(row => row.user_id))

    const rowsByUser = new Map<string, typeof dueRows>()
    for (const row of dueRows) {
      const existing = rowsByUser.get(row.user_id)
      if (existing) existing.push(row)
      else rowsByUser.set(row.user_id, [row])
    }

    const stats = {
      delivered: 0,
      preview_delivered: 0,
      overage_delivered: 0,
      quota_blocked: 0,
      duplicate: 0,
      insert_errors: 0,
      expired: expiredRows?.length ?? 0,
      users_with_due_backlog: rowsByUser.size,
      feedback_reordered: 0,
    }

    for (const [userId, rows] of rowsByUser.entries()) {
      const settings = userSettingsMap.get(userId) ?? {
        plan: 'free' as PlanTier,
        allowLeadOverage: false,
        slackWebhookUrl: null,
      }

      const planLimits = getPlanLimits(settings.plan)
      const allowance = computeDeliveryAllowance({
        plan: settings.plan,
        monthlyLimit: planLimits.leads_per_month,
        used: unlockedUsage.get(userId) ?? 0,
        pendingCount: rows.length,
        deliveredLast24h: deliveredLast24h.get(userId) ?? 0,
        allowLeadOverage: settings.allowLeadOverage && settings.plan !== 'free',
      })

      if (allowance <= 0) continue

      const rankedRows = sortQueueRowsByFeedback(rows, feedbackMaps)
      stats.feedback_reordered += rankedRows.filter(row => row.feedbackBoost !== 0).length

      for (const rankedRow of rankedRows.slice(0, allowance)) {
        const row = rankedRow
        const used = unlockedUsage.get(userId) ?? 0
        const allowLeadOverage = settings.allowLeadOverage && settings.plan !== 'free'
        const quotaDecision = resolveLeadQuotaDecision({
          used,
          monthlyLimit: planLimits.leads_per_month,
          allowLeadOverage,
          plan: settings.plan,
        })

        let reservedQuota = false
        let isOverageLead = false
        let isUnlockedLead = true

        if (quotaDecision === 'reserve') {
          const { data: quotaReserved, error: quotaErr } = await supabase.rpc('consume_lead_quota', {
            p_user_id: userId,
            p_limit: planLimits.leads_per_month,
          })
          if (quotaErr) {
            console.error('[deliver-leads] consume quota error:', quotaErr.message)
            stats.insert_errors++
            continue
          }

          if (quotaReserved) {
            reservedQuota = true
          } else if (settings.plan === 'free') {
            isUnlockedLead = false
          } else if (allowLeadOverage) {
            isOverageLead = true
          } else {
            stats.quota_blocked++
            await rescheduleQueueRow(supabase, row.id, row.attempt_count, nextQuotaRetryAt())
            continue
          }
        } else if (quotaDecision === 'overage') {
          isOverageLead = true
        } else if (quotaDecision === 'preview') {
          isUnlockedLead = false
        } else {
          stats.quota_blocked++
          await rescheduleQueueRow(supabase, row.id, row.attempt_count, nextQuotaRetryAt())
          continue
        }

        const signalRow = Array.isArray(row.signals) ? row.signals[0] : row.signals
        const signalType = (signalRow as { signal_type?: string } | null)?.signal_type ?? 'funding'
        const signalHeadline = (signalRow as { headline?: string } | null)?.headline
        const signalSummary = (signalRow as { summary?: string } | null)?.summary

        const { data: inserted, error } = await supabase.from('leads').insert({
          user_id: userId,
          client_id: row.client_id,
          signal_id: row.signal_id,
          target_company: row.target_company,
          company_domain: row.company_domain ?? null,
          relevance_score: row.relevance_score,
          relevance_reason: row.relevance_reason,
          status: 'new',
          is_unlocked: isUnlockedLead,
          unlocked_at: isUnlockedLead ? nowIso : null,
          dedupe_key: row.dedupe_key,
          match_debug: row.match_debug,
        }).select('id').single()

        if (error || !inserted) {
          if (reservedQuota) {
            await supabase.rpc('refund_lead_quota', { p_user_id: userId })
          }

          if (error?.code === '23505') {
            stats.duplicate++
            await markQueueDuplicate(supabase, row.id, row.attempt_count)
          } else {
            stats.insert_errors++
            if (error) console.error('[deliver-leads] lead insert error:', error.message)
            await rescheduleQueueRow(supabase, row.id, row.attempt_count, nextQuotaRetryAt(new Date()))
          }
          continue
        }

        if (isUnlockedLead) {
          unlockedUsage.set(userId, used + 1)
        } else {
          stats.preview_delivered++
        }
        if (isOverageLead) {
          stats.overage_delivered++
          recordLeadOverage(userId, inserted.id).catch(err =>
            console.error('[deliver-leads] overage record failed:', err)
          )
        }

        deliveredLast24h.set(userId, (deliveredLast24h.get(userId) ?? 0) + 1)
        stats.delivered++

        await supabase
          .from('lead_delivery_queue')
          .update({
            queue_status: 'delivered',
            delivered_at: nowIso,
            delivered_lead_id: inserted.id,
            last_attempted_at: nowIso,
            attempt_count: row.attempt_count + 1,
          })
          .eq('id', row.id)

        emitCrmLeadEvent({
          userId,
          clientId: row.client_id,
          eventType: 'lead.created',
          payload: {
            lead_id: inserted.id,
            target_company: row.target_company,
            signal_type: signalType,
            relevance_score: row.relevance_score,
          },
        }).catch(() => {})

        if (planLimits.slack && settings.slackWebhookUrl && row.relevance_score >= 7) {
          sendSlackAlert(
            settings.slackWebhookUrl,
            row.target_company,
            signalType,
            signalHeadline ?? signalSummary ?? '',
            row.relevance_score,
          ).catch(() => {})
        }

        if (!usersWithAnyLead.has(userId)) {
          usersWithAnyLead.add(userId)
          const admin = createAdminClient()
          const clientName = (row.match_debug as { client_name?: string } | null)?.client_name ?? row.target_company
          admin.auth.admin.getUserById(userId)
            .then(({ data }) => {
              const email = data.user?.email
              if (email) {
                sendFirstLeadEmail(email, clientName, row.target_company, signalType).catch(() => {})
              }
            })
            .catch(() => {})
        }
      }
    }

    await finishCronRun(supabase, runId, { status: 'success', metrics: stats })
    return NextResponse.json(stats)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    console.error('[deliver-leads]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function rescheduleQueueRow(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  queueId: string,
  attemptCount: number,
  nextDeliveryAt: string,
) {
  const { error } = await supabase
    .from('lead_delivery_queue')
    .update({
      next_delivery_at: nextDeliveryAt,
      last_attempted_at: new Date().toISOString(),
      attempt_count: attemptCount + 1,
    })
    .eq('id', queueId)

  if (error) {
    console.error('[deliver-leads] queue reschedule error:', error.message)
  }
}

async function markQueueDuplicate(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  queueId: string,
  attemptCount: number,
) {
  const { error } = await supabase
    .from('lead_delivery_queue')
    .update({
      queue_status: 'duplicate',
      last_attempted_at: new Date().toISOString(),
      attempt_count: attemptCount + 1,
    })
    .eq('id', queueId)

  if (error) {
    console.error('[deliver-leads] queue duplicate mark error:', error.message)
  }
}
