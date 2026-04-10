import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreLeadRelevance } from '@/lib/claude'

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

  // Get recent signals (limit 500, most recent first)
  const { data: newSignals, error: sigErr } = await supabase
    .from('signals')
    .select('id, company_name, signal_type, summary, signal_embedding')
    .order('processed_at', { ascending: false })
    .limit(500)

  if (sigErr || !newSignals?.length) {
    return NextResponse.json({ matched: 0, reason: 'No signals found' })
  }

  // Get all active profiles with their targeting preferences
  const { data: profiles, error: profErr } = await supabase
    .from('user_profiles')
    .select('user_id, company_name, services_description, profile_embedding, target_signal_types, min_relevance_score')

  if (profErr || !profiles?.length) {
    return NextResponse.json({ matched: 0, reason: 'No profiles' })
  }

  // Build a per-user watchlist map for boost logic
  const { data: watchlistRows } = await supabase
    .from('watchlist_companies')
    .select('user_id, company_name')

  const watchlistMap: Record<string, Set<string>> = {}
  for (const row of (watchlistRows ?? [])) {
    if (!watchlistMap[row.user_id]) watchlistMap[row.user_id] = new Set()
    watchlistMap[row.user_id].add(row.company_name.toLowerCase())
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
  }

  for (const signal of newSignals) {
    if (!signal.signal_embedding) { stats.no_signal_embedding++; continue }

    for (const profile of profiles) {
      if (!profile.profile_embedding) { stats.no_profile_embedding++; continue }

      // Respect user's target_signal_types preference
      const allowedTypes = (profile.target_signal_types as string[] | null) ??
        ['funding', 'acquisition', 'expansion', 'regulation', 'hiring']
      if (!allowedTypes.includes(signal.signal_type)) {
        stats.signal_type_filtered++
        continue
      }

      // Skip if lead already exists
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('user_id', profile.user_id)
        .eq('signal_id', signal.id)
        .maybeSingle()

      if (existing) continue

      // Watchlist boost: bypass similarity check for explicitly watched companies
      const userWatchlist = watchlistMap[profile.user_id]
      const isWatchlisted = userWatchlist?.has(signal.company_name.toLowerCase()) ?? false

      if (!isWatchlisted) {
        // Vector similarity check
        const { data: simResult, error: rpcErr } = await supabase.rpc('cosine_similarity', {
          a: signal.signal_embedding,
          b: profile.profile_embedding,
        })

        if (rpcErr) {
          stats.rpc_errors++
          if (stats.rpc_errors === 1) console.error('cosine_similarity RPC error:', rpcErr.message)
          // Fall through without vector filter if RPC is unavailable
        } else {
          const similarity = simResult as number | null
          if (!similarity || similarity < DEFAULT_SIMILARITY_THRESHOLD) {
            stats.below_similarity++
            continue
          }
        }
      }

      // LLM scoring
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

      // Use profile's min_relevance_score or default
      const minScore = (profile.min_relevance_score as number | null) ?? DEFAULT_SCORE_THRESHOLD
      // Watchlisted companies get a lower bar (always show if score >= 4)
      const effectiveMin = isWatchlisted ? Math.min(minScore, 4) : minScore

      if (score < effectiveMin) { stats.below_score++; continue }

      const { error } = await supabase.from('leads').insert({
        user_id:          profile.user_id,
        signal_id:        signal.id,
        target_company:   signal.company_name,
        relevance_score:  score,
        relevance_reason: isWatchlisted
          ? `[Watchlisted] ${reason}`
          : reason,
        status: 'new',
      })

      if (!error) matched++
    }
  }

  console.log('Match stats:', stats)
  return NextResponse.json({ matched, stats })
}
