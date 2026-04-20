import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreLeadRelevance } from '@/lib/claude'
import { getPlanLimits } from '@/lib/plan'
import { sendSlackAlert } from '@/lib/slack'

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.35
const DEFAULT_SCORE_THRESHOLD = 6

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

  const { data: newSignals, error: sigErr } = await supabase
    .from('signals')
    .select('id, company_name, signal_type, summary, headline, signal_embedding, company_domain')
    .order('processed_at', { ascending: false })
    .limit(500)

  if (sigErr || !newSignals?.length) {
    return NextResponse.json({ matched: 0, reason: 'No signals found' })
  }

  const { data: profiles, error: profErr } = await supabase
    .from('user_profiles')
    .select('user_id, company_name, services_description, profile_embedding, target_signal_types, min_relevance_score, plan, slack_webhook_url')

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
  }

  for (const signal of newSignals) {
    if (!signal.signal_embedding) { stats.no_signal_embedding++; continue }

    for (const profile of profiles) {
      if (!profile.profile_embedding) { stats.no_profile_embedding++; continue }

      const pairKey = `${profile.user_id}:${signal.id}`
      if (existingSet.has(pairKey)) { stats.duplicate++; continue }

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
        existingSet.add(pairKey)

        // Slack alert for Max plan users with webhook configured
        const planLimits = getPlanLimits((profile.plan ?? 'free') as 'free' | 'pro' | 'max')
        if (planLimits.slack && profile.slack_webhook_url && score >= 70) {
          sendSlackAlert(profile.slack_webhook_url, signal.company_name, signal.signal_type, signal.headline ?? signal.summary ?? '', score).catch(() => {})
        }
      }
    }
  }

  console.log('Match stats:', stats)
  return NextResponse.json({ matched, stats })
}
