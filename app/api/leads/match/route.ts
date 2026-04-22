import { NextResponse } from 'next/server'
import { createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { scoreLeadRelevance } from '@/lib/claude'
import { getPlanLimits, type PlanTier } from '@/lib/plan'
import { sendSlackAlert } from '@/lib/slack'
import { sendFirstLeadEmail } from '@/lib/resend'
import { recordLeadOverage } from '@/lib/dodo'

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

  // Only match signals published within the last 72 hours — older signals are less actionable
  const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()

  const { data: newSignals, error: sigErr } = await supabase
    .from('signals')
    .select('id, company_name, signal_type, summary, headline, signal_embedding, company_domain')
    .gte('published_at', seventyTwoHoursAgo)
    .order('published_at', { ascending: false })
    .limit(500)

  if (sigErr || !newSignals?.length) {
    return NextResponse.json({ matched: 0, reason: 'No signals found' })
  }

  const { data: profiles, error: profErr } = await supabase
    .from('user_profiles')
    .select('user_id, company_name, services_description, profile_embedding, icp_keywords, target_signal_types, min_relevance_score, plan, slack_webhook_url, allow_lead_overage')

  if (profErr || !profiles?.length) {
    return NextResponse.json({ matched: 0, reason: 'No profiles' })
  }

  const { data: watchlistRows } = await supabase
    .from('watchlist_companies')
    .select('user_id, company_name')

  const watchlistMap: Record<string, Set<string>> = {}
  for (const row of (watchlistRows ?? [])) {
    if (!watchlistMap[row.user_id]) watchlistMap[row.user_id] = new Set()
    watchlistMap[row.user_id].add(row.company_name.toLowerCase())
  }

  // Blocked companies: skip inserting leads for these
  const { data: blockedRows } = await supabase
    .from('blocked_companies')
    .select('user_id, company_name, company_domain')

  const blockedMap: Record<string, Set<string>> = {}
  for (const row of (blockedRows ?? [])) {
    if (!blockedMap[row.user_id]) blockedMap[row.user_id] = new Set()
    if (row.company_domain) blockedMap[row.user_id].add(row.company_domain.toLowerCase())
    blockedMap[row.user_id].add(row.company_name.toLowerCase())
  }

  // Batch existence check: single query instead of one per (user, signal) pair
  const signalIds = newSignals.map(s => s.id)
  const { data: existingLeads } = await supabase
    .from('leads')
    .select('user_id, signal_id')
    .in('signal_id', signalIds)

  const existingSet = new Set<string>()
  for (const row of (existingLeads ?? [])) {
    existingSet.add(`${row.user_id}:${row.signal_id}`)
  }

  // Company-level dedup: skip if user already has a lead for this company in the last 7 days
  // Prevents 3 leads for "Stripe raises $X" from 3 separate news sources
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentCompanyLeads } = await supabase
    .from('leads')
    .select('user_id, target_company, company_domain')
    .gte('created_at', sevenDaysAgo)

  const recentCompanySet = new Set<string>()
  for (const row of (recentCompanyLeads ?? [])) {
    const domainKey = row.company_domain?.toLowerCase()
    const nameKey   = row.target_company.toLowerCase()
    if (domainKey) recentCompanySet.add(`${row.user_id}:${domainKey}`)
    recentCompanySet.add(`${row.user_id}:${nameKey}`)
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
  }

  const quotaState = new Map<string, number>()
  for (const row of (recentQuotaLeads ?? [])) {
    quotaState.set(row.user_id, (quotaState.get(row.user_id) ?? 0) + 1)
  }
  for (const profile of profiles) {
    if (!quotaState.has(profile.user_id)) {
      quotaState.set(profile.user_id, 0)
    }
  }

  for (const signal of newSignals) {
    if (!signal.signal_embedding) { stats.no_signal_embedding++; continue }

    for (const profile of profiles) {
      if (!profile.profile_embedding) { stats.no_profile_embedding++; continue }

      const pairKey = `${profile.user_id}:${signal.id}`
      if (existingSet.has(pairKey)) { stats.duplicate++; continue }

      // Skip if user already has a lead for this company in the last 7 days
      const sigDomainKey = signal.company_domain?.toLowerCase()
      const sigNameKey   = signal.company_name.toLowerCase()
      if (
        (sigDomainKey && recentCompanySet.has(`${profile.user_id}:${sigDomainKey}`)) ||
        recentCompanySet.has(`${profile.user_id}:${sigNameKey}`)
      ) { stats.company_duplicate++; continue }

      // Skip blocked companies
      const userBlocked = blockedMap[profile.user_id]
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

      const userWatchlist = watchlistMap[profile.user_id]
      const isWatchlisted = userWatchlist?.has(signal.company_name.toLowerCase()) ?? false

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

      const plan = (profile.plan ?? 'free') as PlanTier
      const monthlyLimit = getPlanLimits(plan).leads_per_month
      const used = quotaState.get(profile.user_id) ?? 0
      const allowLeadOverage = Boolean((profile as { allow_lead_overage?: boolean | null }).allow_lead_overage) && plan !== 'free'
      let reservedQuota = false
      let isOverageLead = used >= monthlyLimit

      if (!isOverageLead) {
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
      } else if (!allowLeadOverage) {
        stats.quota_reached++
        continue
      }

      const { data: inserted, error } = await supabase.from('leads').insert({
        user_id:          profile.user_id,
        signal_id:        signal.id,
        target_company:   signal.company_name,
        company_domain:   signal.company_domain ?? null,
        relevance_score:  score,
        relevance_reason: isWatchlisted ? `[Watchlisted] ${reason}` : reason,
        status: 'new',
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
        existingSet.add(pairKey)
        if (sigDomainKey) recentCompanySet.add(`${profile.user_id}:${sigDomainKey}`)
        recentCompanySet.add(`${profile.user_id}:${sigNameKey}`)

        // Slack alert for Max plan users with webhook configured
        const planLimits = getPlanLimits((profile.plan ?? 'free') as 'free' | 'pro' | 'max')
        if (planLimits.slack && profile.slack_webhook_url && score >= 7) {
          sendSlackAlert(profile.slack_webhook_url, signal.company_name, signal.signal_type, signal.headline ?? signal.summary ?? '', score).catch(() => {})
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
                sendFirstLeadEmail(email, profile.company_name, signal.company_name, signal.signal_type).catch(() => {})
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
  return NextResponse.json({ matched, stats })
}
