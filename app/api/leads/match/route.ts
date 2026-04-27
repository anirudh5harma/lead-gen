import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreLeadRelevance } from '@/lib/deepseek'
import { normalizePlanTier, type PlanTier } from '@/lib/plan'
import { buildWorkspaceAccessPlan } from '@/lib/client-workspaces'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import { embed, toVectorLiteral } from '@/lib/embeddings'
import { buildLeadDedupeKey, normalizeLeadCompanyKey } from '@/lib/lead-dedupe'
import { computeQueuePriority, queueExpiryFromPublishedAt } from '@/lib/lead-delivery'
import {
  mergeProfileCandidates,
  signalTextMatchesKeywords,
  type MatchSignalCandidate,
} from '@/lib/match-candidates'
import {
  buildFeedbackMaps,
  computeCandidateFeedbackBoost,
  getFeedbackWindowStart,
} from '@/lib/ranking-feedback'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_SIMILARITY_THRESHOLD = 0.3
const KEYWORD_MATCH_SIMILARITY_DISCOUNT = 0.08
const DEFAULT_SCORE_THRESHOLD = 6
const DEDUPE_WINDOW_HOURS = 72
const RECENT_SIGNAL_LIMIT = 1200
const ANN_CANDIDATE_LIMIT = 40
const PROFILE_CANDIDATE_LIMIT = 30
const LLM_RERANK_LIMIT = 12
const ANN_SIMILARITY_FLOOR = 0.18

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

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
    const windowStart = new Date(Date.now() - DEDUPE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()

    const { data: recentSignals, error: sigErr } = await supabase
      .from('signals')
      .select('id, company_name, signal_type, summary, headline, signal_embedding, company_domain, novelty_key, published_at, source_name')
      .gte('published_at', windowStart)
      .order('published_at', { ascending: false })
      .limit(RECENT_SIGNAL_LIMIT)

    if (sigErr || !recentSignals?.length) {
      const payload = { queued: 0, reason: 'No signals found' }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const recentSignalsById = new Map<string, MatchSignalCandidate>()
    for (const signal of recentSignals) {
      recentSignalsById.set(signal.id, signal)
    }

    const { data: profiles, error: profErr } = await supabase
      .from('client_accounts')
      .select('id, user_id, name, services_description, profile_embedding, icp_keywords, target_signal_types, min_relevance_score, created_at, is_archived')

    if (profErr || !profiles?.length) {
      const payload = { queued: 0, reason: 'No profiles' }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const userIds = [...new Set(profiles.map(profile => profile.user_id))]
    const { data: userSettings } = await supabase
      .from('user_profiles')
      .select('user_id, plan, active_client_id')
      .in('user_id', userIds)

    const userSettingsMap = new Map<string, {
      plan: PlanTier
      activeClientId: string | null
    }>()
    for (const row of (userSettings ?? [])) {
      userSettingsMap.set(row.user_id, {
        plan: normalizePlanTier(row.plan),
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
      const payload = { queued: 0, reason: 'No eligible profiles' }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const clientIds = eligibleProfiles.map(profile => profile.id)
    const signalIds = recentSignals.map(signal => signal.id)
    const [watchlistRowsResult, blockedRowsResult, liveQueueRowsResult, recentLeadsResult] = await Promise.all([
      supabase
        .from('watchlist_companies')
        .select('client_id, company_name, company_domain')
        .in('client_id', clientIds),
      supabase
        .from('blocked_companies')
        .select('client_id, company_name, company_domain')
        .in('client_id', clientIds),
      supabase
        .from('lead_delivery_queue')
        .select('client_id, signal_id, dedupe_key, target_company, company_domain, queue_status, signals(signal_type, novelty_key)')
        .in('client_id', clientIds)
        .in('signal_id', signalIds),
      supabase
        .from('leads')
        .select('client_id, signal_id, target_company, company_domain, dedupe_key, signals(signal_type, novelty_key)')
        .in('client_id', clientIds)
        .gte('created_at', windowStart),
    ])

    const watchlistMap: Record<string, Set<string>> = {}
    for (const row of (watchlistRowsResult.data ?? [])) {
      if (!row.client_id) continue
      if (!watchlistMap[row.client_id]) watchlistMap[row.client_id] = new Set()
      watchlistMap[row.client_id].add(normalizeLeadCompanyKey(row.company_name, row.company_domain))
    }

    const blockedMap: Record<string, Set<string>> = {}
    for (const row of (blockedRowsResult.data ?? [])) {
      if (!row.client_id) continue
      if (!blockedMap[row.client_id]) blockedMap[row.client_id] = new Set()
      blockedMap[row.client_id].add(normalizeLeadCompanyKey(row.company_name, row.company_domain))
    }

    const feedbackWindowStart = getFeedbackWindowStart()
    const { data: feedbackLeadRows } = clientIds.length > 0
      ? await supabase
          .from('leads')
          .select('client_id, target_company, company_domain, status, is_unlocked, created_at, unlocked_at, sent_at, replied_at, booked_at, signals(signal_type, source_name)')
          .in('client_id', clientIds)
          .gte('created_at', feedbackWindowStart)
      : { data: [] }
    const feedbackMaps = buildFeedbackMaps((feedbackLeadRows ?? []) as Array<{
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

    const existingPairSet = new Set<string>()
    const recentCompanySet = new Set<string>()
    const recentNoveltySet = new Set<string>()

    for (const row of (liveQueueRowsResult.data ?? [])) {
      if (!row.client_id) continue
      if (row.signal_id) existingPairSet.add(`${row.client_id}:${row.signal_id}`)
      if (row.queue_status === 'pending' || row.queue_status === 'delivered') {
        if (row.dedupe_key) recentCompanySet.add(`${row.client_id}:${row.dedupe_key}`)
        const signalRow = Array.isArray(row.signals) ? row.signals[0] : row.signals
        const noveltyKey = (signalRow as { novelty_key?: string | null } | null)?.novelty_key
        if (noveltyKey) recentNoveltySet.add(`${row.client_id}:${noveltyKey}`)
        const signalType = (signalRow as { signal_type?: string } | null)?.signal_type
        if (!signalType) continue
        const companyKey = normalizeLeadCompanyKey(row.target_company, row.company_domain)
        recentCompanySet.add(`${row.client_id}:${companyKey}:${signalType}`)
      }
    }

    for (const row of (recentLeadsResult.data ?? [])) {
      if (!row.client_id) continue
      if (row.signal_id) existingPairSet.add(`${row.client_id}:${row.signal_id}`)
      if (row.dedupe_key) recentCompanySet.add(`${row.client_id}:${row.dedupe_key}`)
      const signalRow = Array.isArray(row.signals) ? row.signals[0] : row.signals
      const noveltyKey = (signalRow as { novelty_key?: string | null } | null)?.novelty_key
      if (noveltyKey) recentNoveltySet.add(`${row.client_id}:${noveltyKey}`)
      const signalType = (signalRow as { signal_type?: string } | null)?.signal_type
      if (!signalType) continue
      const companyKey = normalizeLeadCompanyKey(row.target_company, row.company_domain)
      recentCompanySet.add(`${row.client_id}:${companyKey}:${signalType}`)
    }

    const stats = {
      no_profile_embedding: 0,
      profile_embedding_backfilled: 0,
      ann_candidates: 0,
      watchlist_candidates: 0,
      keyword_candidates: 0,
      candidate_pool_total: 0,
      candidate_pool_kept: 0,
      below_similarity: 0,
      llm_errors: 0,
      below_score: 0,
      feedback_positive: 0,
      feedback_negative: 0,
      duplicate: 0,
      company_duplicate: 0,
      queue_insert_errors: 0,
      keyword_matches: 0,
      keyword_misses: 0,
      eligible_profiles: eligibleProfiles.length,
      profiles_considered: 0,
      scored_by_llm: 0,
    }
    let queued = 0

    for (const profile of eligibleProfiles) {
      stats.profiles_considered++
      let profileEmbedding = profile.profile_embedding
      if (!profileEmbedding) {
        try {
          const embedding = await embed(`${profile.name} ${profile.services_description}`)
          profileEmbedding = toVectorLiteral(embedding)
          await supabase
            .from('client_accounts')
            .update({ profile_embedding: profileEmbedding })
            .eq('id', profile.id)
          stats.profile_embedding_backfilled++
        } catch (error) {
          stats.no_profile_embedding++
          if (stats.no_profile_embedding === 1) {
            console.error('profile embedding backfill error:', (error as Error).message)
          }
          continue
        }
      }

      const allowedTypes = (profile.target_signal_types as string[] | null) ??
        ['funding', 'acquisition', 'expansion', 'regulation', 'hiring']
      const allowedTypeSet = new Set(allowedTypes)
      const watchlist = watchlistMap[profile.id] ?? new Set<string>()
      const icpKeywords = (profile.icp_keywords as string[] | null) ?? []

      const annResult = await supabase.rpc('match_candidate_signals', {
        p_profile_embedding: profileEmbedding,
        p_signal_types: allowedTypes,
        p_since: windowStart,
        p_limit: ANN_CANDIDATE_LIMIT,
        p_similarity_floor: ANN_SIMILARITY_FLOOR,
      })

      if (annResult.error) {
        console.error('[match-leads] match_candidate_signals RPC error:', annResult.error.message)
      }

      const annCandidates = (annResult.data ?? []) as Array<MatchSignalCandidate & { similarity?: number | null }>
      stats.ann_candidates += annCandidates.length

      const watchlistCandidates = recentSignals.filter(signal =>
        allowedTypeSet.has(signal.signal_type) &&
        watchlist.has(normalizeLeadCompanyKey(signal.company_name, signal.company_domain)),
      )
      stats.watchlist_candidates += watchlistCandidates.length

      const keywordCandidates = icpKeywords.length > 0
        ? recentSignals.filter(signal =>
            allowedTypeSet.has(signal.signal_type) &&
            signalTextMatchesKeywords(signal, icpKeywords),
          )
        : []
      stats.keyword_candidates += keywordCandidates.length

      const mergedCandidates = mergeProfileCandidates([
        ...annCandidates.map(signal => ({
          signal,
          similarity: typeof signal.similarity === 'number' ? signal.similarity : null,
          keywordMatched: false,
          isWatchlisted: watchlist.has(normalizeLeadCompanyKey(signal.company_name, signal.company_domain)),
        })),
        ...watchlistCandidates.map(signal => ({
          signal,
          similarity: null,
          keywordMatched: false,
          isWatchlisted: true,
        })),
        ...keywordCandidates.map(signal => ({
          signal,
          similarity: (annCandidates.find(candidate => candidate.id === signal.id)?.similarity as number | null | undefined) ?? null,
          keywordMatched: true,
          isWatchlisted: watchlist.has(normalizeLeadCompanyKey(signal.company_name, signal.company_domain)),
        })),
      ], PROFILE_CANDIDATE_LIMIT)

      stats.candidate_pool_total += annCandidates.length + watchlistCandidates.length + keywordCandidates.length
      stats.candidate_pool_kept += mergedCandidates.length

      const rerankCandidates = mergedCandidates
        .map(candidate => {
          const feedbackBoost = computeCandidateFeedbackBoost(feedbackMaps, {
            clientId: profile.id,
            companyName: candidate.signal.company_name,
            companyDomain: candidate.signal.company_domain,
            signalType: candidate.signal.signal_type,
            sourceName: candidate.signal.source_name,
          })
          if (feedbackBoost > 0) stats.feedback_positive++
          if (feedbackBoost < 0) stats.feedback_negative++
          return {
            ...candidate,
            feedbackBoost,
            adjustedRank: candidate.rank + feedbackBoost,
          }
        })
        .sort((a, b) => b.adjustedRank - a.adjustedRank || b.rank - a.rank)
        .slice(0, LLM_RERANK_LIMIT)
      for (const candidate of rerankCandidates) {
        const signal = recentSignalsById.get(candidate.signal.id) ?? candidate.signal
        const pairKey = `${profile.id}:${signal.id}`
        if (existingPairSet.has(pairKey)) {
          stats.duplicate++
          continue
        }
        if (signal.novelty_key && recentNoveltySet.has(`${profile.id}:${signal.novelty_key}`)) {
          stats.company_duplicate++
          continue
        }

        const companyKey = normalizeLeadCompanyKey(signal.company_name, signal.company_domain)
        const dedupeKey = buildLeadDedupeKey({
          companyName: signal.company_name,
          companyDomain: signal.company_domain,
          signalType: signal.signal_type,
          noveltyKey: signal.novelty_key,
        })
        if (
          recentCompanySet.has(`${profile.id}:${dedupeKey}`) ||
          recentCompanySet.has(`${profile.id}:${companyKey}:${signal.signal_type}`)
        ) {
          stats.company_duplicate++
          continue
        }

        const userBlocked = blockedMap[profile.id]
        if (userBlocked) {
          const blockedCompanyKey = normalizeLeadCompanyKey(signal.company_name, signal.company_domain)
          if (userBlocked.has(blockedCompanyKey)) {
            continue
          }
        }

        const effectiveSimilarityThreshold = Math.max(
          0.22,
          DEFAULT_SIMILARITY_THRESHOLD - (candidate.keywordMatched ? KEYWORD_MATCH_SIMILARITY_DISCOUNT : 0),
        )
        if (!candidate.isWatchlisted && typeof candidate.similarity === 'number' && candidate.similarity < effectiveSimilarityThreshold) {
          stats.below_similarity++
          continue
        }

        if (candidate.keywordMatched) stats.keyword_matches++
        else if (icpKeywords.length > 0) stats.keyword_misses++

        let score = 5
        let reason = ''
        try {
          const result = await scoreLeadRelevance(
            profile.services_description,
            signal.signal_type,
            signal.company_name,
            signal.summary || '',
          )
          stats.scored_by_llm++
          score = result.score
          reason = result.reason
        } catch (error) {
          stats.llm_errors++
          if (stats.llm_errors === 1) console.error('scoreLeadRelevance error:', (error as Error).message)
          const fallback = fallbackLeadScore({
            isWatchlisted: candidate.isWatchlisted === true,
            keywordMatched: candidate.keywordMatched === true,
            similarity: candidate.similarity,
          })
          if (!fallback) continue
          score = fallback.score
          reason = fallback.reason
        }

        const minScore = (profile.min_relevance_score as number | null) ?? DEFAULT_SCORE_THRESHOLD
        const effectiveMin = candidate.isWatchlisted ? Math.min(minScore, 4) : minScore
        if (score < effectiveMin) {
          stats.below_score++
          continue
        }

        const priorityScore = computeQueuePriority({
          relevanceScore: score,
          publishedAt: signal.published_at,
          sourceName: signal.source_name,
          isWatchlisted: candidate.isWatchlisted,
          keywordMatched: candidate.keywordMatched,
        }) + candidate.feedbackBoost

        const { error } = await supabase.from('lead_delivery_queue').insert({
          user_id: profile.user_id,
          client_id: profile.id,
          signal_id: signal.id,
          target_company: signal.company_name,
          company_domain: signal.company_domain ?? null,
          relevance_score: score,
          relevance_reason: candidate.isWatchlisted ? `[Watchlisted] ${reason}` : reason,
          priority_score: priorityScore,
          dedupe_key: dedupeKey,
          source_name: signal.source_name ?? null,
          published_at: signal.published_at ?? null,
          match_debug: {
            client_id: profile.id,
            client_name: profile.name,
            matched_via: candidate.isWatchlisted ? 'watchlist' : candidate.keywordMatched ? 'keyword_or_semantic' : 'semantic_match',
            similarity: candidate.isWatchlisted ? null : candidate.similarity ?? null,
            keyword_matched: candidate.keywordMatched,
            min_relevance_score: effectiveMin,
            candidate_rank: candidate.rank,
            feedback_boost: candidate.feedbackBoost,
            adjusted_candidate_rank: candidate.adjustedRank,
          },
          queue_status: 'pending',
          next_delivery_at: new Date().toISOString(),
          expires_at: queueExpiryFromPublishedAt(signal.published_at ?? null),
        })

        if (error) {
          if (error.code === '23505') {
            stats.duplicate++
          } else {
            stats.queue_insert_errors++
            console.error('lead queue insert error:', error.message)
          }
          continue
        }

        queued++
        existingPairSet.add(pairKey)
        if (signal.novelty_key) recentNoveltySet.add(`${profile.id}:${signal.novelty_key}`)
        recentCompanySet.add(`${profile.id}:${dedupeKey}`)
        recentCompanySet.add(`${profile.id}:${companyKey}:${signal.signal_type}`)
      }
    }

    const payload = { queued, stats }
    await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    console.error('[match-leads]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function fallbackLeadScore(params: {
  isWatchlisted: boolean
  keywordMatched: boolean
  similarity: number | null | undefined
}): { score: number; reason: string } | null {
  if (params.isWatchlisted) {
    return {
      score: 7,
      reason: 'Matched a watchlisted company. AI relevance scoring was unavailable, so this lead was admitted with a conservative watchlist score.',
    }
  }

  if (params.keywordMatched) {
    return {
      score: 6,
      reason: 'Matched ICP keywords in a recent buying signal. AI relevance scoring was unavailable, so this lead was admitted at the default relevance threshold.',
    }
  }

  if (typeof params.similarity === 'number' && params.similarity >= 0.42) {
    return {
      score: 6,
      reason: 'Strong semantic fit against the workspace ICP. AI relevance scoring was unavailable, so this lead was admitted at the default relevance threshold.',
    }
  }

  return null
}
