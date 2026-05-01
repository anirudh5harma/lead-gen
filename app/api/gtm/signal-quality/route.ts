import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { computeLeadFeedbackScore, getFeedbackWindowStart, type FeedbackLeadRow } from '@/lib/ranking-feedback'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface SignalRow {
  id: string
  account_id: string | null
  lead_id: string | null
  signal_type: string
  headline: string
  summary: string | null
  source_name: string | null
  source_url: string | null
  published_at: string | null
  confidence: number | string | null
  attributes: Record<string, unknown> | null
  observed_at: string
}

interface LeadRow extends FeedbackLeadRow {
  id: string
  target_company: string
  company_domain: string | null
  relevance_score: number
  relevance_reason: string | null
  feed_snapshot: unknown
}

interface AccountRow {
  id: string
  name: string
  domain: string | null
  lifecycle_stage: string
  last_seen_at: string
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const limit = Math.max(10, Math.min(100, Number(url.searchParams.get('limit') ?? 60)))
  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}
  const feedbackStart = getFeedbackWindowStart()

  const [signalsRes, leadsRes, accountsRes, feedbackRes] = await Promise.all([
    supabase
      .from('gtm_signals')
      .select('id, account_id, lead_id, signal_type, headline, summary, source_name, source_url, published_at, confidence, attributes, observed_at')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('observed_at', { ascending: false })
      .limit(limit),
    supabase
      .from('leads')
      .select('id, client_id, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, created_at, unlocked_at, sent_at, replied_at, booked_at, feed_snapshot')
      .eq('user_id', user.id)
      .match(clientFilter)
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
      .limit(250),
    supabase
      .from('gtm_accounts')
      .select('id, name, domain, lifecycle_stage, last_seen_at')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('last_seen_at', { ascending: false })
      .limit(250),
    supabase
      .from('leads')
      .select('client_id, target_company, company_domain, status, is_unlocked, created_at, unlocked_at, sent_at, replied_at, booked_at, feed_snapshot')
      .eq('user_id', user.id)
      .match(clientFilter)
      .gte('created_at', feedbackStart)
      .limit(1000),
  ])

  if (signalsRes.error) return NextResponse.json({ error: signalsRes.error.message }, { status: 500 })
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 })
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })
  if (feedbackRes.error) return NextResponse.json({ error: feedbackRes.error.message }, { status: 500 })

  const signals = (signalsRes.data ?? []) as SignalRow[]
  const leads = (leadsRes.data ?? []) as LeadRow[]
  const accounts = (accountsRes.data ?? []) as AccountRow[]
  const feedbackRows = (feedbackRes.data ?? []) as Array<FeedbackLeadRow & { feed_snapshot?: unknown }>
  const leadById = new Map(leads.map(lead => [lead.id, lead]))
  const accountById = new Map(accounts.map(account => [account.id, account]))
  const feedbackBySignalType = buildFeedbackIndex(feedbackRows, 'signal_type')
  const feedbackBySource = buildFeedbackIndex(feedbackRows, 'source_name')

  const items = signals.map(signal => {
    const lead = signal.lead_id ? leadById.get(signal.lead_id) ?? null : null
    const account = signal.account_id ? accountById.get(signal.account_id) ?? null : null
    const confidence = Number(signal.confidence ?? 0)
    const relevance = lead?.relevance_score ?? 0
    const scores = extractSignalScores(signal.attributes)
    const feedbackScore = (
      (feedbackBySignalType.get(signal.signal_type.toLowerCase()) ?? 0) +
      (signal.source_name ? feedbackBySource.get(signal.source_name.toLowerCase()) ?? 0 : 0)
    )
    const qualityScore = scores
      ? Math.max(0, Math.min(100, Math.round(
          scores.quality * 0.28 +
          scores.novelty * 0.14 +
          scores.fit * 0.24 +
          scores.urgency * 0.18 +
          scores.outreachability * 0.16 +
          Math.max(-15, Math.min(15, feedbackScore)),
        )))
      : Math.max(0, Math.min(100, Math.round(
          (confidence * 35) +
          (relevance * 5) +
          Math.max(-15, Math.min(15, feedbackScore)),
        )))

    return {
      id: signal.id,
      account_id: signal.account_id,
      lead_id: signal.lead_id,
      account_name: account?.name ?? lead?.target_company ?? 'Unknown account',
      account_domain: account?.domain ?? lead?.company_domain ?? null,
      signal_type: signal.signal_type,
      headline: signal.headline,
      summary: signal.summary,
      source_name: signal.source_name,
      source_url: signal.source_url,
      published_at: signal.published_at,
      observed_at: signal.observed_at,
      confidence,
      relevance_score: relevance,
      quality_score: qualityScore,
      score_breakdown: scores,
      cluster_key: stringAttribute(signal.attributes, 'cluster_key'),
      outcome: lead ? classifyOutcome(lead) : 'unmatched',
      reason: lead?.relevance_reason ?? inferSignalReason(signal),
    }
  })

  const byType = aggregate(items, item => item.signal_type)
  const bySource = aggregate(items, item => item.source_name ?? 'unknown')
  const totals = {
    signals: items.length,
    high_quality: items.filter(item => item.quality_score >= 70).length,
    weak: items.filter(item => item.quality_score < 45).length,
    with_outcome: items.filter(item => item.outcome === 'replied' || item.outcome === 'booked' || item.outcome === 'sent').length,
  }

  return NextResponse.json({ totals, by_type: byType, by_source: bySource, signals: items })
}

function extractSignalScores(attributes: Record<string, unknown> | null) {
  const raw = attributes?.scores
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const scores = raw as Record<string, unknown>
  return {
    quality: numberScore(scores.quality),
    novelty: numberScore(scores.novelty),
    fit: numberScore(scores.fit),
    urgency: numberScore(scores.urgency),
    outreachability: numberScore(scores.outreachability),
    source_reliability: numberScore(scores.source_reliability),
  }
}

function stringAttribute(attributes: Record<string, unknown> | null, key: string): string | null {
  const value = attributes?.[key]
  return typeof value === 'string' ? value : null
}

function numberScore(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

function classifyOutcome(lead: LeadRow): string {
  if (lead.booked_at || lead.status === 'booked') return 'booked'
  if (lead.replied_at || lead.status === 'replied') return 'replied'
  if (lead.sent_at || lead.status === 'sent') return 'sent'
  if (lead.status === 'drafted') return 'drafted'
  if (lead.is_unlocked) return 'unlocked'
  return lead.status || 'new'
}

function inferSignalReason(signal: SignalRow): string {
  return signal.summary ?? `${signal.signal_type.replace(/_/g, ' ')} signal from ${signal.source_name ?? 'source'}.`
}

function buildFeedbackIndex(rows: Array<FeedbackLeadRow & { feed_snapshot?: unknown }>, field: 'signal_type' | 'source_name') {
  const map = new Map<string, number>()
  for (const row of rows) {
    const snapshot = normalizeLeadFeedSnapshot(row.feed_snapshot ?? null)
    const raw = field === 'signal_type' ? snapshot?.signal_type : snapshot?.source_name
    const key = raw?.trim().toLowerCase()
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + computeLeadFeedbackScore(row))
  }
  return map
}

function aggregate<T extends { quality_score: number; outcome: string }>(items: T[], keyFn: (item: T) => string) {
  const groups = new Map<string, { key: string; count: number; avg_quality: number; outcomes: Record<string, number> }>()
  for (const item of items) {
    const key = keyFn(item)
    const existing = groups.get(key) ?? { key, count: 0, avg_quality: 0, outcomes: {} }
    existing.count += 1
    existing.avg_quality += item.quality_score
    existing.outcomes[item.outcome] = (existing.outcomes[item.outcome] ?? 0) + 1
    groups.set(key, existing)
  }
  return [...groups.values()]
    .map(group => ({ ...group, avg_quality: Math.round(group.avg_quality / Math.max(1, group.count)) }))
    .sort((a, b) => b.count - a.count || b.avg_quality - a.avg_quality)
}
