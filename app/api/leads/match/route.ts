import { NextResponse } from 'next/server'
import { createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { scoreLeadRelevance } from '@/lib/claude'
import { getPlanLimits, type PlanTier } from '@/lib/plan'
import { sendSlackAlert } from '@/lib/slack'
import { sendFirstLeadEmail } from '@/lib/resend'
import { recordLeadOverage } from '@/lib/dodo'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { buildWorkspaceAccessPlan } from '@/lib/client-workspaces'
import { resolveLeadQuotaDecision } from '@/lib/lead-quota'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.5
const DEFAULT_SCORE_THRESHOLD = 7

export async function GET(request: Request) {
  return runMatch(request)
}

export async function POST(request: Request) {
  return runMatch(request)
}

async function runMatch(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'match_leads')

  try {
    // Only match signals published within the last 72 hours — older signals are less actionable
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

    const { data: newSignals, error: sigErr } = await supabase
      .from('signals')
      .select('id, company_name, signal_type, summary, headline, signal_embedding, company_domain')
      .gte('published_at', seventyTwoHoursAgo)
      .order('published_at', { ascending: false })
      .limit(500)

    if (sigErr || !newSignals?.length) {
      const payload = { matched: 0, reason: 'No signals found' }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const { data: profiles, error: profErr } = await supabase
      .from('client_accounts')
      .select('id, user_id, name, services_description, profile_embedding, icp_keywords, target_signal_types, min_relevance_score, created_at, is_archived')

    if (profErr || !profiles?.length) {
      const payload = { matched: 0, reason: 'No profiles' }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const userIds = [...new Set(profiles.map(p => p.user_id))]
    const { data: userSettings } = await supabase
      .from('user_profiles')
      .select('user_id, plan, slack_webhook_url, allow_lead_overage, active_client_id')
      .in('user_id', userIds)

    const userSettingsMap = new Map<string, {
      plan: PlanTier
      slackWebhookUrl: string | null
      allowLeadOverage: boolean
      activeClientId: string | null
    }>()
    for (const row of (userSettings ?? [])) {
      userSettingsMap.set(row.user_id, {
        plan: (row.plan ?? 'free') as PlanTier,
        slackWebhookUrl: row.slack_webhook_url ?? null,
        allowLeadOverage: row.allow_lead_overage ?? false,
        activeClientId: row.active_client_id ?? null,
      })
    }

    const profilesByUser = new Map<string, typeof profiles>()
    for (const profile of profiles) {
      const existing = profilesByUser.get(profile.user_id)
      if (existing) existing.push(profile)
      else profilesByUser.set(profile.user_id, [profile])
    }

    const eligibleProfiles = Array.from(profilesByUser.entries()).flatMap(([userId, userProfiles]) => {
      const settings = userSettingsMap.get(userId) ?? {
        plan: 'free' as PlanTier,
        slackWebhookUrl: null,
        allowLeadOverage: false,
        activeClientId: null,
      }

      const accessPlan = buildWorkspaceAccessPlan({
        plan: settings.plan,
        activeClientId: settings.activeClientId,
        clients: userProfiles.map(profile => ({
          id: profile.id,
          created_at: profile.created_at,
          is_archived: profile.is_archived,
        })),
      })

      const visibleIds = new Set(accessPlan.visibleClientIds)
      return userProfiles.filter(profile => visibleIds.has(profile.id))
    })

    if (eligibleProfiles.length === 0) {
      const payload = { matched: 0, reason: 'No eligible profiles' }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const { data: watchlistRows } = await supabase
      .from('watchlist_companies')
      .select('client_id, company_name')

    const watchlistMap: Record<string, Set<string>> = {}
    for (const row of (watchlistRows ?? [])) {
      if (!row.client_id) continue
      if (!watchlistMap[row.client_id]) watchlistMap[row.client_id] = new Set()
      watchlistMap[row.client_id].add(row.company_name.toLowerCase())
    }

  // Blocked companies: skip inserting leads for these
    const { data: blockedRows } = await supabase
      .from('blocked_companies')
      .select('client_id, company_name, company_domain')

    const blockedMap: Record<string, Set<string>> = {}
    for (const row of (blockedRows ?? [])) {
      if (!row.client_id) continue
      if (!blockedMap[row.client_id]) blockedMap[row.client_id] = new Set()
      if (row.company_domain) blockedMap[row.client_id].add(row.company_domain.toLowerCase())
      blockedMap[row.client_id].add(row.company_name.toLowerCase())
    }

  // Batch existence check: single query instead of one per (user, signal) pair
    const signalIds = newSignals.map(s => s.id)
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('client_id, signal_id')
      .in('signal_id', signalIds)

    const existingSet = new Set<string>()
    for (const row of (existingLeads ?? [])) {
      if (!row.client_id) continue
      existingSet.add(`${row.client_id}:${row.signal_id}`)
    }

  // Company-level dedup: skip if user already has a lead for this company in the last 7 days
  // Prevents 3 leads for "Stripe raises $X" from 3 separate news sources
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentCompanyLeads } = await supabase
      .from('leads')
      .select('client_id, target_company, company_domain')
      .gte('created_at', sevenDaysAgo)

    const recentCompanySet = new Set<string>()
    for (const row of (recentCompanyLeads ?? [])) {
      if (!row.client_id) continue
      const domainKey = row.company_domain?.toLowerCase()
      const nameKey   = row.target_company.toLowerCase()
      if (domainKey) recentCompanySet.add(`${row.client_id}:${domainKey}`)
      recentCompanySet.add(`${row.client_id}:${nameKey}`)
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentQuotaLeads } = await supabase
      .from('leads')
      .select('user_id')
      .gte('created_at', thirtyDaysAgo)

    let matched = 0
    const stats = {
      no_signal_embedding: 0,
      no_profile_embedding: 0,
      signal_type_filtered: 0,
      below_similarity: 0,
      rpc_errors: 0,
      claude_errors: 0,
      below_score: 0,
      duplicate: 0,
      company_duplicate: 0,
      icp_filtered: 0,
      quota_reached: 0,
      overage_inserted: 0,
      eligible_profiles: eligibleProfiles.length,
    }

    const quotaState = new Map<string, number>()
    for (const row of (recentQuotaLeads ?? [])) {
      quotaState.set(row.user_id, (quotaState.get(row.user_id) ?? 0) + 1)
    }
    for (const profile of eligibleProfiles) {
      if (!quotaState.has(profile.user_id)) {
        quotaState.set(profile.user_id, 0)
      }
    }

    for (const signal of newSignals) {
      if (!signal.signal_embedding) { stats.no_signal_embedding++; continue }

      for (const profile of eligibleProfiles) {
        if (!profile.profile_embedding) { stats.no_profile_embedding++; continue }

      const pairKey = `${profile.id}:${signal.id}`
      if (existingSet.has(pairKey)) { stats.duplicate++; continue }

      // Skip if user already has a lead for this company in the last 7 days
      const sigDomainKey = signal.company_domain?.toLowerCase()
      const sigNameKey   = signal.company_name.toLowerCase()
      if (
        (sigDomainKey && recentCompanySet.has(`${profile.id}:${sigDomainKey}`)) ||
        recentCompanySet.has(`${profile.id}:${sigNameKey}`)
      ) { stats.company_duplicate++; continue }

      // Skip blocked companies
      const userBlocked = blockedMap[profile.id]
      if (userBlocked) {
        const companyKey = signal.company_name.toLowerCase()
        const domainKey  = signal.company_domain?.toLowerCase()
        if (userBlocked.has(companyKey) || (domainKey && userBlocked.has(domainKey))) continue
      }

      const allowedTypes = (profile.target_signal_types as string[] | null) ??
        ['funding', 'acquisition', 'expansion', 'regulation', 'hiring']
      if (!allowedTypes.includes(signal.signal_type)) {
        stats.signal_type_filtered++
        continue
      }

      const userWatchlist = watchlistMap[profile.id]
      const isWatchlisted = userWatchlist?.has(signal.company_name.toLowerCase()) ?? false
      let similarityForDebug: number | null = null

      // ICP keyword pre-filter: fast string check before expensive RPC + Claude call
      if (!isWatchlisted) {
        const icpKeywords = (profile.icp_keywords as string[] | null) ?? []
        if (icpKeywords.length > 0) {
          const signalText = `${signal.company_name} ${signal.signal_type} ${signal.summary ?? ''} ${signal.headline ?? ''}`.toLowerCase()
          const hasMatch = icpKeywords.some(kw => signalText.includes(kw.toLowerCase()))
          if (!hasMatch) { stats.icp_filtered++; continue }
        }
      }

      if (!isWatchlisted) {
        const { data: simResult, error: rpcErr } = await supabase.rpc('cosine_similarity', {
          a: signal.signal_embedding,
          b: profile.profile_embedding,
        })

        if (rpcErr) {
          stats.rpc_errors++
          if (stats.rpc_errors === 1) console.error('cosine_similarity RPC error:', rpcErr.message)
        } else {
          const similarity = simResult as number | null
          similarityForDebug = similarity ?? null
          if (!similarity || similarity < DEFAULT_SIMILARITY_THRESHOLD) {
            stats.below_similarity++
            continue
          }
        }
      }

      let score = 5
      let reason = ''
      try {
        const result = await scoreLeadRelevance(
          profile.services_description,
          signal.signal_type,
          signal.company_name,
          signal.summary || ''
        )
        score = result.score
        reason = result.reason
      } catch (e) {
        stats.claude_errors++
        if (stats.claude_errors === 1) console.error('scoreLeadRelevance error:', (e as Error).message)
        continue
      }

      const minScore = (profile.min_relevance_score as number | null) ?? DEFAULT_SCORE_THRESHOLD
      const effectiveMin = isWatchlisted ? Math.min(minScore, 4) : minScore

      if (score < effectiveMin) { stats.below_score++; continue }

        const settings = userSettingsMap.get(profile.user_id) ?? {
          plan: 'free' as PlanTier,
          slackWebhookUrl: null,
          allowLeadOverage: false,
          activeClientId: null,
        }
        const plan = settings.plan
        const monthlyLimit = getPlanLimits(plan).leads_per_month
        const used = quotaState.get(profile.user_id) ?? 0
        const allowLeadOverage = settings.allowLeadOverage && plan !== 'free'
        let reservedQuota = false
        let isOverageLead = false

        const quotaDecision = resolveLeadQuotaDecision({
          used,
          monthlyLimit,
          allowLeadOverage,
          plan,
        })

        if (quotaDecision === 'reserve') {
          const { data: quotaReserved, error: quotaErr } = await supabase.rpc('consume_lead_quota', {
            p_user_id: profile.user_id,
            p_limit: monthlyLimit,
          })
          if (quotaErr) {
            console.error('consume_lead_quota RPC error:', quotaErr.message)
            stats.rpc_errors++
            continue
          }
          if (quotaReserved) {
            reservedQuota = true
          } else if (allowLeadOverage) {
            isOverageLead = true
          } else {
            stats.quota_reached++
            continue
          }
        } else if (quotaDecision === 'overage') {
          isOverageLead = true
        } else {
          stats.quota_reached++
          continue
        }

      const { data: inserted, error } = await supabase.from('leads').insert({
        user_id:          profile.user_id,
        client_id:        profile.id,
        signal_id:        signal.id,
        target_company:   signal.company_name,
        company_domain:   signal.company_domain ?? null,
        relevance_score:  score,
        relevance_reason: isWatchlisted ? `[Watchlisted] ${reason}` : reason,
        status: 'new',
        match_debug: {
          client_id: profile.id,
          client_name: profile.name,
          matched_via: isWatchlisted ? 'watchlist' : 'scored_match',
          similarity: isWatchlisted ? null : similarityForDebug,
          min_relevance_score: effectiveMin,
        },
      }).select('id').single()

      if (!error && inserted) {
        matched++
        quotaState.set(profile.user_id, used + 1)
        if (isOverageLead) {
          stats.overage_inserted++
          recordLeadOverage(profile.user_id, inserted.id).catch(err =>
            console.error('[overage] lead record failed:', err)
          )
        }
        emitCrmLeadEvent({
          userId: profile.user_id,
          clientId: profile.id,
          eventType: 'lead.created',
          payload: {
            lead_id: inserted.id,
            target_company: signal.company_name,
            signal_type: signal.signal_type,
            relevance_score: score,
          },
        }).catch(() => {})
        existingSet.add(pairKey)
        if (sigDomainKey) recentCompanySet.add(`${profile.id}:${sigDomainKey}`)
        recentCompanySet.add(`${profile.id}:${sigNameKey}`)

        // Slack alert for Max plan users with webhook configured
        const planLimits = getPlanLimits(plan)
        if (planLimits.slack && settings.slackWebhookUrl && score >= 7) {
          sendSlackAlert(settings.slackWebhookUrl, signal.company_name, signal.signal_type, signal.headline ?? signal.summary ?? '', score).catch(() => {})
        }

        // First-lead email: check if this is user's very first lead
        const { count } = await supabase
          .from('leads')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', profile.user_id)
        if (count === 1) {
          const admin = createAdminClient()
          admin.auth.admin.getUserById(profile.user_id)
            .then(({ data }) => {
              const email = data.user?.email
              if (email) {
                sendFirstLeadEmail(email, profile.name, signal.company_name, signal.signal_type).catch(() => {})
              }
            })
            .catch(() => {})
        }
      } else if (reservedQuota) {
        await supabase.rpc('refund_lead_quota', { p_user_id: profile.user_id })
      }
    }
    }

    console.log('Match stats:', stats)
    const payload = { matched, stats }
    await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    console.error('[match-leads]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
