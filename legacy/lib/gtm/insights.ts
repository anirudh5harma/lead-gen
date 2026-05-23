import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { upsertGtmAction } from './actions'
import { eventIdempotencyKey, recordGtmEvent } from './events'
import { upsertGtmEntityEmbedding } from './semantic-context'

export interface GtmInsight {
  id: string
  insight_type: string
  title: string
  summary: string
  evidence: Array<{ label: string; value: string }>
  confidence: number
  impact_score: number
  recommended_action_type: string
  recommended_action_payload: Record<string, unknown>
  status: 'open' | 'actioned' | 'dismissed' | 'archived'
  created_at: string
}

interface InsightCandidate {
  insight_key: string
  insight_type: string
  title: string
  summary: string
  evidence: Array<{ label: string; value: string }>
  confidence: number
  impact_score: number
  recommended_action_type: string
  recommended_action_payload: Record<string, unknown>
}

interface LeadRow {
  id: string
  target_company: string
  company_domain: string | null
  status: string
  relevance_score: number | null
  contact_email: string | null
  contact_verified: boolean | null
  contact_verified_at: string | null
  created_at: string
  sent_at: string | null
  replied_at: string | null
  booked_at: string | null
  reply_summary: string | null
  feed_snapshot: unknown
}

interface SourceRunRow {
  source_name: string
  source_type: string
  fetched_count: number | null
  filter_passed_count: number | null
  inserted_signal_count: number | null
  estimated_cost_usd: number | string | null
  started_at: string
}

interface ContentIdeaRow {
  id: string
  status: string
  content_type: string
  pain_category: string
  created_at: string
}

interface InsightRow extends Omit<GtmInsight, 'evidence' | 'confidence'> {
  evidence: unknown
  confidence: number | string
}

export async function listGtmInsights(
  supabase: SupabaseClient,
  input: { userId: string; clientId?: string | null; limit?: number },
): Promise<{ insights: GtmInsight[]; metrics: Record<string, number> }> {
  const clientId = input.clientId ?? null
  await generateGtmInsights(supabase, { userId: input.userId, clientId })

  let query = supabase
    .from('gtm_insights')
    .select('id, insight_type, title, summary, evidence, confidence, impact_score, recommended_action_type, recommended_action_payload, status, created_at')
    .eq('user_id', input.userId)
    .in('status', ['open', 'actioned'])
    .order('impact_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(80, input.limit ?? 40)))
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  const insights = ((data ?? []) as InsightRow[]).map(row => ({
    ...row,
    confidence: Number(row.confidence ?? 0),
    evidence: normalizeEvidence(row.evidence),
    recommended_action_payload: normalizePayload(row.recommended_action_payload),
  }))

  return {
    insights,
    metrics: {
      open: insights.filter(insight => insight.status === 'open').length,
      actioned: insights.filter(insight => insight.status === 'actioned').length,
      high_impact: insights.filter(insight => insight.impact_score >= 75).length,
      content_opportunities: insights.filter(insight => insight.insight_type === 'content_opportunity').length,
    },
  }
}

export async function updateGtmInsight(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    insightId: string
    action: 'action' | 'dismiss'
  },
): Promise<void> {
  const clientId = input.clientId ?? null
  let query = supabase
    .from('gtm_insights')
    .select('id, insight_type, title, summary, impact_score, recommended_action_type, recommended_action_payload')
    .eq('id', input.insightId)
    .eq('user_id', input.userId)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data: insight, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  if (!insight) throw new Error('Insight not found')

  const nextStatus = input.action === 'dismiss' ? 'dismissed' : 'actioned'
  const { error: updateError } = await supabase
    .from('gtm_insights')
    .update({ status: nextStatus })
    .eq('id', input.insightId)
    .eq('user_id', input.userId)
  if (updateError) throw new Error(updateError.message)

  if (input.action === 'action') {
    await upsertGtmAction(supabase, {
      userId: input.userId,
      clientId,
      actionType: String(insight.recommended_action_type ?? 'insight.action'),
      channel: 'insights',
      title: String(insight.title ?? 'Insight action'),
      body: String(insight.summary ?? ''),
      priority: Math.max(40, Math.min(100, Number(insight.impact_score ?? 50))),
      status: 'open',
      payload: {
        insight_id: input.insightId,
        recommended_action_payload: normalizePayload(insight.recommended_action_payload),
      },
      source: 'gtm_insights',
      sourceItemKey: `insight:${input.insightId}`,
    })
  }

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId,
    entityType: 'insight',
    entityId: input.insightId,
    eventType: `insight.${nextStatus}`,
    source: 'gtm_insights',
    payload: { insight_id: input.insightId, action: input.action },
    idempotencyKey: eventIdempotencyKey(['insight', input.insightId, input.action]),
  })

  await upsertGtmEntityEmbedding(supabase, {
    userId: input.userId,
    clientId,
    entityType: 'insight',
    entityId: input.insightId,
    content: `${String(insight.insight_type ?? 'insight')}: ${String(insight.title ?? '')}\n${String(insight.summary ?? '')}`,
    source: 'gtm_insights',
    metadata: {
      action: input.action,
      status: nextStatus,
      recommended_action_type: insight.recommended_action_type ?? null,
    },
  })
}

async function generateGtmInsights(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
): Promise<void> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  let leadQuery = supabase
    .from('leads')
    .select('id, target_company, company_domain, status, relevance_score, contact_email, contact_verified, contact_verified_at, created_at, sent_at, replied_at, booked_at, reply_summary, feed_snapshot')
    .eq('user_id', input.userId)
    .neq('status', 'dismissed')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(500)
  leadQuery = input.clientId ? leadQuery.eq('client_id', input.clientId) : leadQuery.is('client_id', null)

  const [leadsRes, sourceRunsRes, contentRes] = await Promise.all([
    leadQuery,
    supabase
      .from('gtm_source_runs')
      .select('source_name, source_type, fetched_count, filter_passed_count, inserted_signal_count, estimated_cost_usd, started_at')
      .gte('started_at', weekAgo)
      .order('started_at', { ascending: false })
      .limit(400),
    scopedQuery(
      supabase
        .from('gtm_content_ideas')
        .select('id, status, content_type, pain_category, created_at')
        .eq('user_id', input.userId)
        .gte('created_at', weekAgo)
        .limit(200),
      input.clientId,
    ),
  ])

  if (leadsRes.error) {
    console.error('[gtm-insights] lead query failed:', leadsRes.error.message)
    return
  }
  if (sourceRunsRes.error) console.error('[gtm-insights] source query failed:', sourceRunsRes.error.message)
  if (contentRes.error) console.error('[gtm-insights] content query failed:', contentRes.error.message)

  const leads = (leadsRes.data ?? []) as LeadRow[]
  const sourceRuns = (sourceRunsRes.data ?? []) as SourceRunRow[]
  const contentIdeas = (contentRes.data ?? []) as ContentIdeaRow[]
  const candidates = [
    ...sourceInsights(sourceRuns),
    ...contactInsights(leads),
    ...pipelineInsights(leads),
    ...contentInsights(contentIdeas, leads),
    ...coverageInsights(leads),
  ].slice(0, 12)

  await insertMissingInsights(supabase, input, candidates)
}

async function insertMissingInsights(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null },
  candidates: InsightCandidate[],
): Promise<void> {
  if (candidates.length === 0) return
  const keys = candidates.map(candidate => candidate.insight_key)
  let existingQuery = supabase
    .from('gtm_insights')
    .select('insight_key')
    .eq('user_id', input.userId)
    .in('insight_key', keys)
  existingQuery = input.clientId ? existingQuery.eq('client_id', input.clientId) : existingQuery.is('client_id', null)

  const { data: existing, error } = await existingQuery
  if (error) {
    console.error('[gtm-insights] existing lookup failed:', error.message)
    return
  }

  const existingKeys = new Set(((existing ?? []) as Array<{ insight_key: string }>).map(row => row.insight_key))
  const rows = candidates
    .filter(candidate => !existingKeys.has(candidate.insight_key))
    .map(candidate => ({
      user_id: input.userId,
      client_id: input.clientId,
      ...candidate,
    }))
  if (rows.length === 0) return

  const { data: inserted, error: insertError } = await supabase
    .from('gtm_insights')
    .insert(rows)
    .select('id, insight_type, title, summary, impact_score')
  if (insertError) {
    console.error('[gtm-insights] insert failed:', insertError.message)
    return
  }

  for (const insight of (inserted ?? []) as Array<{ id: string; insight_type?: string; title?: string; summary?: string; impact_score?: number }>) {
    await upsertGtmEntityEmbedding(supabase, {
      userId: input.userId,
      clientId: input.clientId,
      entityType: 'insight',
      entityId: insight.id,
      content: `${insight.insight_type ?? 'insight'}: ${insight.title ?? ''}\n${insight.summary ?? ''}`,
      source: 'gtm_insights',
      metadata: { impact_score: insight.impact_score ?? null },
    })
  }
}

function sourceInsights(rows: SourceRunRow[]): InsightCandidate[] {
  const bySource = new Map<string, { source: string; fetched: number; passed: number; inserted: number; cost: number }>()
  for (const row of rows) {
    const source = row.source_name || 'unknown'
    const current = bySource.get(source) ?? { source, fetched: 0, passed: 0, inserted: 0, cost: 0 }
    current.fetched += numberValue(row.fetched_count)
    current.passed += numberValue(row.filter_passed_count)
    current.inserted += numberValue(row.inserted_signal_count)
    current.cost += Number(row.estimated_cost_usd ?? 0) || 0
    bySource.set(source, current)
  }

  const insights: InsightCandidate[] = []
  const sources = [...bySource.values()].filter(source => source.fetched > 0)
  const winner = sources.sort((a, b) => b.inserted - a.inserted || b.passed - a.passed)[0]
  if (winner && winner.inserted >= 3) {
    insights.push({
      insight_key: `source_winner:${winner.source}`,
      insight_type: 'source_winner',
      title: `${winner.source} is producing useful signals`,
      summary: `${winner.source} inserted ${winner.inserted} signals from ${winner.fetched} fetched items in the last week.`,
      evidence: [
        { label: 'Inserted', value: String(winner.inserted) },
        { label: 'Fetched', value: String(winner.fetched) },
      ],
      confidence: 0.82,
      impact_score: Math.min(92, 62 + winner.inserted * 4),
      recommended_action_type: 'source.increase_priority',
      recommended_action_payload: { source_name: winner.source },
    })
  }

  const waste = sources.find(source => source.fetched >= 20 && source.inserted === 0)
  if (waste) {
    insights.push({
      insight_key: `source_waste:${waste.source}`,
      insight_type: 'source_waste',
      title: `${waste.source} looks noisy`,
      summary: `${waste.source} fetched ${waste.fetched} items without inserting a signal in the last week.`,
      evidence: [
        { label: 'Fetched', value: String(waste.fetched) },
        { label: 'Inserted', value: '0' },
      ],
      confidence: 0.78,
      impact_score: 70,
      recommended_action_type: 'source.review_noise',
      recommended_action_payload: { source_name: waste.source },
    })
  }
  return insights
}

function contactInsights(leads: LeadRow[]): InsightCandidate[] {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const stale = leads.filter(lead => (
    lead.contact_email &&
    lead.contact_verified === true &&
    (!lead.contact_verified_at || new Date(lead.contact_verified_at).getTime() < cutoff) &&
    !lead.sent_at &&
    lead.status !== 'replied' &&
    lead.status !== 'booked'
  ))
  if (stale.length === 0) return []

  return [{
    insight_key: 'stale_contact_risk:30d',
    insight_type: 'stale_contact_risk',
    title: `${stale.length} verified contacts need recheck`,
    summary: 'Some ready accounts have contacts verified more than 30 days ago. Reverify before sending to avoid bounces.',
    evidence: stale.slice(0, 3).map(lead => ({ label: lead.target_company, value: lead.contact_email ?? '' })),
    confidence: 0.9,
    impact_score: Math.min(88, 58 + stale.length * 5),
    recommended_action_type: 'contacts.reverify_stale',
    recommended_action_payload: { lead_ids: stale.map(lead => lead.id).slice(0, 20) },
  }]
}

function pipelineInsights(leads: LeadRow[]): InsightCandidate[] {
  const sent = leads.filter(lead => lead.sent_at || lead.status === 'sent').length
  const replies = leads.filter(lead => lead.replied_at || lead.status === 'replied').length
  const booked = leads.filter(lead => lead.booked_at || lead.status === 'booked').length
  const ready = leads.filter(lead => (lead.relevance_score ?? 0) >= 8 && lead.contact_verified && !lead.sent_at).length
  const insights: InsightCandidate[] = []

  if (ready >= 3) {
    insights.push({
      insight_key: 'pipeline_movement:ready_high_fit',
      insight_type: 'pipeline_movement',
      title: `${ready} high-fit accounts are ready`,
      summary: 'There are verified, high-score accounts waiting for outreach review.',
      evidence: [{ label: 'Ready accounts', value: String(ready) }],
      confidence: 0.86,
      impact_score: Math.min(90, 66 + ready * 4),
      recommended_action_type: 'pipeline.review_ready_accounts',
      recommended_action_payload: { min_relevance_score: 8 },
    })
  }

  if (sent >= 5 && replies === 0) {
    insights.push({
      insight_key: 'reply_pattern:no_replies_after_sends',
      insight_type: 'reply_pattern',
      title: 'Reply rate is flat after recent sends',
      summary: `${sent} sent emails have not produced replies yet. Review the opening angle and proof point before increasing volume.`,
      evidence: [
        { label: 'Sent', value: String(sent) },
        { label: 'Replies', value: String(replies) },
      ],
      confidence: 0.72,
      impact_score: 74,
      recommended_action_type: 'messaging.review_angle',
      recommended_action_payload: { sent, replies },
    })
  }

  if (booked > 0 || replies > 0) {
    insights.push({
      insight_key: 'pipeline_movement:positive_response',
      insight_type: 'pipeline_movement',
      title: 'Positive response pattern detected',
      summary: `${replies} replies and ${booked} booked meetings are available for learning. Use them to tune ranking and messaging.`,
      evidence: [
        { label: 'Replies', value: String(replies) },
        { label: 'Booked', value: String(booked) },
      ],
      confidence: 0.84,
      impact_score: 76,
      recommended_action_type: 'learning.review_positive_outcomes',
      recommended_action_payload: { replies, booked },
    })
  }
  return insights
}

function contentInsights(contentIdeas: ContentIdeaRow[], leads: LeadRow[]): InsightCandidate[] {
  const newIdeas = contentIdeas.filter(idea => idea.status === 'new').length
  const signalTypes = new Set(leads.map(lead => normalizeLeadFeedSnapshot(lead.feed_snapshot)?.signal_type).filter(Boolean))
  if (newIdeas === 0 && signalTypes.size < 2) return []
  return [{
    insight_key: 'content_opportunity:signal_backed_queue',
    insight_type: 'content_opportunity',
    title: 'Signal-backed content is ready',
    summary: `${newIdeas} new content ideas are available from recent account movement. Draft the strongest angle before the signal goes stale.`,
    evidence: [
      { label: 'New ideas', value: String(newIdeas) },
      { label: 'Signal types', value: String(signalTypes.size) },
    ],
    confidence: 0.8,
    impact_score: Math.min(84, 60 + newIdeas * 4 + signalTypes.size * 3),
    recommended_action_type: 'content.review_ideas',
    recommended_action_payload: { status: 'new' },
  }]
}

function coverageInsights(leads: LeadRow[]): InsightCandidate[] {
  const byType = new Map<string, number>()
  for (const lead of leads) {
    const signalType = normalizeLeadFeedSnapshot(lead.feed_snapshot)?.signal_type ?? 'unknown'
    byType.set(signalType, (byType.get(signalType) ?? 0) + 1)
  }
  if (byType.size >= 3 || leads.length < 8) return []
  const top = [...byType.entries()].sort((a, b) => b[1] - a[1])[0]
  return [{
    insight_key: 'coverage_gap:signal_mix',
    insight_type: 'coverage_gap',
    title: 'Signal mix is narrow',
    summary: top ? `Most recent opportunities are concentrated in ${top[0]}. Add sources for hiring, compliance, launches, and partnership movement.` : 'Recent opportunities are concentrated in too few signal types.',
    evidence: [...byType.entries()].slice(0, 3).map(([label, value]) => ({ label, value: String(value) })),
    confidence: 0.74,
    impact_score: 68,
    recommended_action_type: 'coverage.expand_signal_mix',
    recommended_action_payload: { current_signal_types: [...byType.keys()] },
  }]
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

function normalizePayload(value: unknown): Record<string, unknown> {
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
