import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { estimateSourceCost } from '@/lib/signal-filter'
import { upsertGtmAction } from './actions'
import { eventIdempotencyKey, recordGtmEvent } from './events'
import { normalizeSourceKey, upsertGtmSource } from './sources'

export interface CoverageRecommendation {
  id: string
  recommendation_type: string
  source_name: string | null
  source_type: string | null
  title: string
  summary: string
  suggested_config: Record<string, unknown>
  evidence: Array<{ label: string; value: string }>
  expected_impact: number
  estimated_cost_usd: number
  status: 'open' | 'applied' | 'dismissed'
  created_at: string
}

interface SourceRunRow {
  source_name: string
  source_type: string
  fetched_count: number | null
  raw_candidate_count: number | null
  filter_passed_count: number | null
  inserted_signal_count: number | null
  estimated_cost_usd: number | string | null
}

interface LeadRow {
  feed_snapshot: unknown
}

interface RecommendationCandidate {
  recommendation_key: string
  recommendation_type: string
  source_name?: string | null
  source_type?: string | null
  title: string
  summary: string
  suggested_config: Record<string, unknown>
  evidence: Array<{ label: string; value: string }>
  expected_impact: number
  estimated_cost_usd?: number
}

interface RecommendationRow extends Omit<CoverageRecommendation, 'evidence' | 'suggested_config' | 'estimated_cost_usd'> {
  evidence: unknown
  suggested_config: unknown
  estimated_cost_usd: number | string | null
}

const SIGNAL_TYPE_FEED_SUGGESTIONS: Record<string, Array<{ source: string; url: string; summary: string }>> = {
  hiring: [
    { source: 'google_news_hiring_execs', url: 'https://news.google.com/rss/search?q=company%20appoints%20chief%20revenue%20officer%20OR%20VP%20sales%20when%3A7d&hl=en-US&gl=US&ceid=US:en', summary: 'Executive hiring and GTM leadership movement.' },
  ],
  regulation: [
    { source: 'google_news_compliance_security', url: 'https://news.google.com/rss/search?q=company%20SOC%202%20OR%20ISO%2027001%20OR%20security%20incident%20OR%20compliance%20when%3A7d&hl=en-US&gl=US&ceid=US:en', summary: 'Compliance, security, and trust pressure.' },
  ],
  expansion: [
    { source: 'google_news_expansion_partnerships', url: 'https://news.google.com/rss/search?q=company%20launches%20new%20product%20OR%20expands%20market%20OR%20partnership%20when%3A7d&hl=en-US&gl=US&ceid=US:en', summary: 'Product, market, and partnership expansion.' },
  ],
  acquisition: [
    { source: 'google_news_acquisition_ma', url: 'https://news.google.com/rss/search?q=company%20acquires%20OR%20acquisition%20OR%20merger%20when%3A7d&hl=en-US&gl=US&ceid=US:en', summary: 'M&A and post-acquisition change.' },
  ],
}

export async function listCoverageRecommendations(
  supabase: SupabaseClient,
  input: { userId: string; clientId?: string | null; limit?: number },
): Promise<{ recommendations: CoverageRecommendation[]; metrics: Record<string, number> }> {
  const clientId = input.clientId ?? null
  await generateCoverageRecommendations(supabase, { userId: input.userId, clientId })

  let query = supabase
    .from('gtm_coverage_recommendations')
    .select('id, recommendation_type, source_name, source_type, title, summary, suggested_config, evidence, expected_impact, estimated_cost_usd, status, created_at')
    .eq('user_id', input.userId)
    .in('status', ['open', 'applied'])
    .order('expected_impact', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(80, input.limit ?? 40)))
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const recommendations = ((data ?? []) as RecommendationRow[]).map(row => ({
    ...row,
    evidence: normalizeEvidence(row.evidence),
    suggested_config: normalizeRecord(row.suggested_config),
    estimated_cost_usd: Number(row.estimated_cost_usd ?? 0) || 0,
  }))

  return {
    recommendations,
    metrics: {
      open: recommendations.filter(item => item.status === 'open').length,
      applied: recommendations.filter(item => item.status === 'applied').length,
      add_feed: recommendations.filter(item => item.recommendation_type === 'add_feed').length,
      source_reviews: recommendations.filter(item => item.recommendation_type.includes('source')).length,
    },
  }
}

export async function updateCoverageRecommendation(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    recommendationId: string
    action: 'apply' | 'dismiss'
  },
): Promise<void> {
  const clientId = input.clientId ?? null
  let query = supabase
    .from('gtm_coverage_recommendations')
    .select('id, recommendation_type, source_name, source_type, title, summary, suggested_config, expected_impact')
    .eq('id', input.recommendationId)
    .eq('user_id', input.userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data: recommendation, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!recommendation) throw new Error('Coverage recommendation not found')

  const status = input.action === 'apply' ? 'applied' : 'dismissed'
  const config = normalizeRecord((recommendation as { suggested_config?: unknown }).suggested_config)

  if (input.action === 'apply') {
    await applyRecommendation(supabase, {
      userId: input.userId,
      clientId,
      recommendation: recommendation as {
        id: string
        recommendation_type: string
        source_name: string | null
        source_type: string | null
        title: string
        summary: string
        expected_impact: number
      },
      config,
    })
  }

  const { error: updateError } = await supabase
    .from('gtm_coverage_recommendations')
    .update({ status })
    .eq('id', input.recommendationId)
    .eq('user_id', input.userId)
  if (updateError) throw new Error(updateError.message)

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId,
    entityType: 'coverage_recommendation',
    entityId: input.recommendationId,
    eventType: `coverage.${status}`,
    source: 'coverage_optimizer',
    payload: { recommendation_id: input.recommendationId, action: input.action, suggested_config: config },
    idempotencyKey: eventIdempotencyKey(['coverage', input.recommendationId, input.action]),
  })
}

async function generateCoverageRecommendations(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<void> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const [runsRes, leadsRes] = await Promise.all([
    supabase
      .from('gtm_source_runs')
      .select('source_name, source_type, fetched_count, raw_candidate_count, filter_passed_count, inserted_signal_count, estimated_cost_usd')
      .gte('started_at', weekAgo)
      .limit(500),
    scopedQuery(
      supabase
        .from('leads')
        .select('feed_snapshot')
        .eq('user_id', input.userId)
        .gte('created_at', weekAgo)
        .neq('status', 'dismissed')
        .limit(500),
      input.clientId,
    ),
  ])

  if (runsRes.error) {
    console.error('[coverage-optimizer] source run query failed:', runsRes.error.message)
    return
  }
  if (leadsRes.error) {
    console.error('[coverage-optimizer] lead query failed:', leadsRes.error.message)
    return
  }

  const candidates = [
    ...sourceEfficiencyRecommendations((runsRes.data ?? []) as SourceRunRow[]),
    ...signalMixRecommendations((leadsRes.data ?? []) as LeadRow[]),
  ]
  await insertMissingRecommendations(supabase, input, candidates)
}

async function insertMissingRecommendations(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
  candidates: RecommendationCandidate[],
): Promise<void> {
  if (candidates.length === 0) return
  const keys = candidates.map(candidate => candidate.recommendation_key)
  let existingQuery = supabase
    .from('gtm_coverage_recommendations')
    .select('recommendation_key')
    .eq('user_id', input.userId)
    .in('recommendation_key', keys)
  existingQuery = input.clientId ? existingQuery.eq('client_id', input.clientId) : existingQuery.is('client_id', null)

  const { data: existing, error } = await existingQuery
  if (error) {
    console.error('[coverage-optimizer] existing lookup failed:', error.message)
    return
  }

  const existingKeys = new Set(((existing ?? []) as Array<{ recommendation_key: string }>).map(row => row.recommendation_key))
  const rows = candidates
    .filter(candidate => !existingKeys.has(candidate.recommendation_key))
    .map(candidate => ({
      user_id: input.userId,
      client_id: input.clientId,
      estimated_cost_usd: candidate.estimated_cost_usd ?? estimateSourceCost(candidate.source_name),
      ...candidate,
    }))
  if (rows.length === 0) return

  const { error: insertError } = await supabase.from('gtm_coverage_recommendations').insert(rows)
  if (insertError) console.error('[coverage-optimizer] insert failed:', insertError.message)
}

function sourceEfficiencyRecommendations(rows: SourceRunRow[]): RecommendationCandidate[] {
  const bySource = new Map<string, { source: string; type: string; fetched: number; raw: number; passed: number; inserted: number; cost: number }>()
  for (const row of rows) {
    const source = row.source_name || 'unknown'
    const current = bySource.get(source) ?? { source, type: row.source_type || 'unknown', fetched: 0, raw: 0, passed: 0, inserted: 0, cost: 0 }
    current.fetched += numberValue(row.fetched_count)
    current.raw += numberValue(row.raw_candidate_count)
    current.passed += numberValue(row.filter_passed_count)
    current.inserted += numberValue(row.inserted_signal_count)
    current.cost += Number(row.estimated_cost_usd ?? 0) || 0
    bySource.set(source, current)
  }

  const recommendations: RecommendationCandidate[] = []
  for (const source of bySource.values()) {
    if (source.inserted >= 4 && source.passed >= source.inserted) {
      recommendations.push({
        recommendation_key: `increase:${source.source}`,
        recommendation_type: 'increase_source_priority',
        source_name: source.source,
        source_type: source.type,
        title: `Increase priority for ${source.source}`,
        summary: `${source.source} produced ${source.inserted} inserted signals from ${source.fetched} fetched items this week.`,
        suggested_config: {
          source_key: normalizeSourceKey(source.source),
          source_name: source.source,
          source_type: source.type,
          priority: 75,
          enabled: true,
        },
        evidence: [
          { label: 'Inserted', value: String(source.inserted) },
          { label: 'Fetched', value: String(source.fetched) },
        ],
        expected_impact: Math.min(92, 64 + source.inserted * 4),
        estimated_cost_usd: source.cost,
      })
    }

    if (source.fetched >= 25 && source.inserted === 0) {
      recommendations.push({
        recommendation_key: `decrease:${source.source}`,
        recommendation_type: 'review_noisy_source',
        source_name: source.source,
        source_type: source.type,
        title: `Review noisy source ${source.source}`,
        summary: `${source.source} fetched ${source.fetched} items without inserting useful signals this week.`,
        suggested_config: {
          source_key: normalizeSourceKey(source.source),
          source_name: source.source,
          source_type: source.type,
          priority: 25,
          enabled: true,
        },
        evidence: [
          { label: 'Fetched', value: String(source.fetched) },
          { label: 'Inserted', value: '0' },
        ],
        expected_impact: 72,
        estimated_cost_usd: source.cost,
      })
    }
  }
  return recommendations.sort((a, b) => b.expected_impact - a.expected_impact).slice(0, 8)
}

function signalMixRecommendations(leads: LeadRow[]): RecommendationCandidate[] {
  const counts = new Map<string, number>()
  for (const lead of leads) {
    const signalType = normalizeLeadFeedSnapshot(lead.feed_snapshot)?.signal_type ?? null
    if (!signalType) continue
    counts.set(signalType, (counts.get(signalType) ?? 0) + 1)
  }

  const recommendations: RecommendationCandidate[] = []
  for (const [signalType, suggestions] of Object.entries(SIGNAL_TYPE_FEED_SUGGESTIONS)) {
    if ((counts.get(signalType) ?? 0) > 0) continue
    const suggestion = suggestions[0]
    recommendations.push({
      recommendation_key: `add_feed:${signalType}:${suggestion.source}`,
      recommendation_type: 'add_feed',
      source_name: suggestion.source,
      source_type: 'news',
      title: `Add ${signalType.replace(/_/g, ' ')} coverage`,
      summary: `No recent ${signalType} opportunities were detected. Add a cheap RSS query for ${suggestion.summary}`,
      suggested_config: {
        source: suggestion.source,
        url: suggestion.url,
        category: `coverage_${signalType}`,
        signal_type: signalType,
      },
      evidence: [
        { label: 'Current count', value: String(counts.get(signalType) ?? 0) },
        { label: 'Feed', value: suggestion.source },
      ],
      expected_impact: 66,
      estimated_cost_usd: estimateSourceCost(suggestion.source),
    })
  }
  return recommendations.slice(0, 4)
}

async function applyRecommendation(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    recommendation: {
      id: string
      recommendation_type: string
      source_name: string | null
      source_type: string | null
      title: string
      summary: string
      expected_impact: number
    }
    config: Record<string, unknown>
  },
): Promise<void> {
  if (input.recommendation.recommendation_type === 'increase_source_priority' || input.recommendation.recommendation_type === 'review_noisy_source') {
    await upsertGtmSource(supabase, {
      userId: input.userId,
      clientId: input.clientId,
      sourceName: input.recommendation.source_name ?? String(input.config.source_name ?? 'unknown'),
      sourceType: input.recommendation.source_type ?? String(input.config.source_type ?? 'unknown'),
      sourceKey: String(input.config.source_key ?? input.recommendation.source_name ?? 'unknown'),
      enabled: input.config.enabled !== false,
      priority: numberValue(input.config.priority),
      attributes: {
        applied_coverage_recommendation_id: input.recommendation.id,
        recommendation_type: input.recommendation.recommendation_type,
      },
    })
  }

  await upsertGtmAction(supabase, {
    userId: input.userId,
    clientId: input.clientId,
    actionType: `coverage.${input.recommendation.recommendation_type}`,
    channel: 'coverage',
    title: input.recommendation.title,
    body: input.recommendation.summary,
    priority: input.recommendation.expected_impact,
    status: input.recommendation.recommendation_type === 'add_feed' ? 'open' : 'completed',
    payload: {
      coverage_recommendation_id: input.recommendation.id,
      suggested_config: input.config,
    },
    result: input.recommendation.recommendation_type === 'add_feed'
      ? {}
      : { applied_to_gtm_sources: true },
    source: 'coverage_optimizer',
    sourceItemKey: `coverage:${input.recommendation.id}`,
  })
}

function normalizeEvidence(value: unknown): Array<{ label: string; value: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map(item => {
      if (typeof item !== 'object' || item === null) return null
      const label = (item as { label?: unknown }).label
      const itemValue = (item as { value?: unknown }).value
      return typeof label === 'string' && typeof itemValue === 'string' ? { label, value: itemValue } : null
    })
    .filter((item): item is { label: string; value: string } => Boolean(item))
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0
}

function scopedQuery<T extends { eq: (column: string, value: string) => T; is: (column: string, value: null) => T }>(
  query: T,
  clientId: string | null,
): T {
  return clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
}
