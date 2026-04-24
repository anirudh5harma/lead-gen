import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getPlanLimits, type PlanTier } from '@/lib/plan'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import { resolveOutreachContext } from '@/lib/outreach-context'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const FOLLOWUP_BATCH_LIMIT = 50
const FOLLOWUP_CLAIM_STALE_MS = 15 * 60 * 1000

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'send_followups')
  try {
    const nowIso = new Date().toISOString()
    const claimToken = crypto.randomUUID()
    const staleBeforeIso = new Date(Date.now() - FOLLOWUP_CLAIM_STALE_MS).toISOString()

    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_due_followups', {
      p_limit: FOLLOWUP_BATCH_LIMIT,
      p_claim_token: claimToken,
      p_now: nowIso,
      p_stale_before: staleBeforeIso,
    })

    if (claimError) {
      throw new Error(claimError.message)
    }

    const claimedIds = ((claimedRows ?? []) as Array<{ id: string | null }>)
      .map(row => row.id)
      .filter((id): id is string => Boolean(id))
    const pendingResult = claimedIds.length > 0
      ? await supabase
          .from('scheduled_followups')
          .select(`
            id, user_id, lead_id, scheduled_for,
            leads(target_company, contact_email, status, message_id, from_email, gmail_thread_id, client_id),
            outreach_sequences(followup_subject, followup_body)
          `)
          .in('id', claimedIds)
      : { data: [], error: null }

    if (pendingResult.error) {
      throw new Error(pendingResult.error.message)
    }
    const pending = pendingResult.data ?? []

    if (!pending.length) {
      const payload = { sent: 0, pending: 0 }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const userIds = [...new Set(pending.map(p => p.user_id))]
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, plan, auto_send_enabled, company_name, services_description, calendly_url')
      .in('user_id', userIds)

    const clientIds = pending
      .map(item => ((item.leads as { client_id?: string | null } | null)?.client_id ?? null))
      .filter((id): id is string => Boolean(id))
    const { data: clientProfiles } = clientIds.length > 0
      ? await supabase
          .from('client_accounts')
          .select('id, name, services_description, calendly_url')
          .in('id', clientIds)
      : { data: [] }

    const quotaMap: Record<string, {
      plan: PlanTier
      autoSend: boolean
      profile: { company_name?: string | null; services_description?: string | null; calendly_url?: string | null }
    }> = {}
    for (const p of (profiles ?? [])) {
      const plan = (p.plan ?? 'free') as PlanTier
      quotaMap[p.user_id] = {
        plan,
        autoSend: p.auto_send_enabled ?? false,
        profile: {
          company_name: (p as { company_name?: string | null }).company_name ?? null,
          services_description: (p as { services_description?: string | null }).services_description ?? null,
          calendly_url: (p as { calendly_url?: string | null }).calendly_url ?? null,
        },
      }
    }
    const clientProfileMap = new Map(
      (clientProfiles ?? []).map(profile => [
        profile.id,
        {
          name: profile.name,
          services_description: profile.services_description,
          calendly_url: (profile as { calendly_url?: string | null }).calendly_url ?? null,
        },
      ]),
    )

    let sent = 0
    for (const item of pending) {
      const quota = quotaMap[item.user_id]
      if (!quota) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      if (!getPlanLimits(quota.plan).followups) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      if (!quota.autoSend) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }

      const lead = item.leads as unknown as {
        contact_email?: string; target_company: string; status?: string
        message_id?: string | null; from_email?: string | null; gmail_thread_id?: string | null
        client_id?: string | null
      } | null
      const seq = item.outreach_sequences as unknown as {
        followup_subject: string; followup_body: string
      } | null

      if (!lead?.contact_email) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }

    // Fall back to a generic follow-up template when pre-generation didn't complete
      const fuSubject = seq?.followup_subject ?? `Following up`
      const fuBody    = seq?.followup_body    ??
        `Probably caught you at a bad time — figured I'd check back in case it's still relevant.\n\nWorth a quick 15-min call this week?`

      if (lead.status === 'replied' || lead.status === 'booked') {
        await completeFollowup(supabase, item.id, claimToken, nowIso)
        continue
      }

      const email = lead.contact_email.toLowerCase()
      const [unsubRes, bounceRes] = await Promise.all([
        supabase.from('unsubscribed_emails').select('id').eq('email', email).maybeSingle(),
        supabase.from('bounced_emails').select('id').eq('email', email).maybeSingle(),
      ])
      if (unsubRes.data || bounceRes.data) {
        await completeFollowup(supabase, item.id, claimToken, nowIso)
        continue
      }

    // For Gmail threads, pass threadId for proper threading.
    // For Outlook, gmail_thread_id stores the conversationId — not directly usable as inReplyTo,
    // but the outlook webhook will handle reply detection via conversationId.
      const gmailThreadId = lead.gmail_thread_id ?? null
      const inReplyTo     = lead.message_id ? `<${lead.message_id}>` : null
      const clientProfile = lead.client_id ? clientProfileMap.get(lead.client_id) ?? null : null
      const outreachContext = resolveOutreachContext({
        userProfile: quota.profile,
        clientProfile,
      })

      try {
        const result = await sendWithConnectedAccount({
          userId:        item.user_id,
          supabase,
          to:            lead.contact_email,
          subject:       fuSubject,
          body:          fuBody,
          fromName:      outreachContext.fromName,
          inReplyTo,
          gmailThreadId,
          preferEmail:   lead.from_email ?? null,
        })

        if (!result) {
          await releaseClaim(supabase, item.id, claimToken)
          continue
        }

        await completeFollowup(supabase, item.id, claimToken, nowIso)
        if (result.messageId) {
          await supabase.from('leads').update({
            message_id:      result.messageId,
            gmail_thread_id: result.threadId ?? lead.gmail_thread_id,
          }).eq('id', item.lead_id)
        }
        sent++
      } catch (err) {
        console.error(`[send-followups] failed for lead ${item.lead_id}:`, err)
        await releaseClaim(supabase, item.id, claimToken)
      }
    }

    const payload = { sent, pending: pending.length }
    await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function completeFollowup(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  followupId: string,
  claimToken: string,
  sentAt: string,
) {
  await supabase
    .from('scheduled_followups')
    .update({
      sent_at: sentAt,
      processing_started_at: null,
      processing_token: null,
    })
    .eq('id', followupId)
    .eq('processing_token', claimToken)
}

async function releaseClaim(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  followupId: string,
  claimToken: string,
) {
  await supabase
    .from('scheduled_followups')
    .update({
      processing_started_at: null,
      processing_token: null,
    })
    .eq('id', followupId)
    .eq('processing_token', claimToken)
    .is('sent_at', null)
}
