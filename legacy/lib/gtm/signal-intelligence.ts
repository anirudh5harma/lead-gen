import type { LeadFeedSnapshot, LeadSignalType } from '@/lib/lead-sources'

export interface SignalIntelligenceInput {
  leadId: string
  accountKey: string
  targetCompany: string
  companyDomain?: string | null
  relevanceScore?: number | null
  relevanceReason?: string | null
  contactEmail?: string | null
  contactVerified?: boolean | null
  createdAt?: string | null
  snapshot: LeadFeedSnapshot
}

export interface StructuredSignalEvent {
  event_type: LeadSignalType
  account_name: string
  account_domain: string | null
  headline: string
  summary: string | null
  source_name: string
  source_url: string | null
  published_at: string | null
}

export interface SignalScoreBreakdown {
  quality: number
  novelty: number
  fit: number
  urgency: number
  outreachability: number
  source_reliability: number
}

export interface SignalIntelligence {
  event: StructuredSignalEvent
  cluster_key: string
  duplicate_key: string
  scores: SignalScoreBreakdown
  weighted_score: number
  reasoning: string[]
}

export function buildSignalIntelligence(input: SignalIntelligenceInput): SignalIntelligence {
  const sourceName = input.snapshot.source_name ?? input.snapshot.provider ?? 'lead_feed'
  const event: StructuredSignalEvent = {
    event_type: input.snapshot.signal_type,
    account_name: input.targetCompany,
    account_domain: input.companyDomain ?? input.snapshot.company_domain ?? null,
    headline: input.snapshot.headline,
    summary: input.snapshot.summary ?? null,
    source_name: sourceName,
    source_url: input.snapshot.source_url ?? null,
    published_at: input.snapshot.published_at ?? input.createdAt ?? null,
  }

  const publishedAt = parseTime(event.published_at)
  const ageDays = publishedAt ? Math.max(0, (Date.now() - publishedAt) / 86_400_000) : null
  const sourceReliability = scoreSourceReliability(sourceName, event.source_url)
  const quality = clampScore(
    42 +
    (event.source_url ? 14 : 0) +
    (event.summary ? 10 : 0) +
    (event.published_at ? 8 : 0) +
    sourceReliability * 0.18 +
    signalTypeQualityBoost(event.event_type),
  )
  const novelty = clampScore(ageDays === null ? 56 : 96 - Math.min(50, ageDays * 2.4))
  const fit = clampScore(35 + normalizeLeadScore(input.relevanceScore) * 6.5 + (input.snapshot.icp_hint ? 8 : 0))
  const urgency = clampScore(signalUrgencyBase(event.event_type) + (ageDays === null ? 0 : Math.max(0, 18 - ageDays * 2)))
  const outreachability = clampScore(
    34 +
    (input.contactEmail ? 26 : 0) +
    (input.contactVerified ? 22 : 0) +
    (event.account_domain ? 8 : 0) +
    (input.snapshot.signal_type === 'crm_import' ? -8 : 0),
  )
  const scores: SignalScoreBreakdown = {
    quality,
    novelty,
    fit,
    urgency,
    outreachability,
    source_reliability: sourceReliability,
  }
  const weightedScore = clampScore(
    quality * 0.22 +
    novelty * 0.16 +
    fit * 0.25 +
    urgency * 0.2 +
    outreachability * 0.17,
  )

  return {
    event,
    cluster_key: buildClusterKey(input.accountKey, event),
    duplicate_key: event.source_url ? stableKey(event.source_url) : stableKey(`${event.headline}:${event.summary ?? ''}`),
    scores,
    weighted_score: weightedScore,
    reasoning: buildReasoning(input, event, scores, weightedScore, ageDays),
  }
}

export function scoreSourceReliability(sourceName: string | null | undefined, sourceUrl?: string | null): number {
  const source = `${sourceName ?? ''} ${sourceUrl ?? ''}`.toLowerCase()
  if (!source.trim()) return 54
  if (source.includes('sec.gov') || source.includes('crunchbase') || source.includes('linkedin')) return 88
  if (source.includes('prnewswire') || source.includes('businesswire') || source.includes('globenewswire')) return 78
  if (source.includes('company') || source.includes('official') || source.includes('crm_import')) return 72
  if (source.includes('explore_generated')) return 58
  if (source.includes('blog') || source.includes('newsletter')) return 62
  return 66
}

function buildClusterKey(account: string, event: StructuredSignalEvent): string {
  const dateBucket = event.published_at ? event.published_at.slice(0, 10) : 'undated'
  const textKey = stableKey(`${event.headline} ${event.summary ?? ''}`).slice(0, 56)
  return `${account}:${event.event_type}:${dateBucket}:${textKey}`
}

function buildReasoning(
  input: SignalIntelligenceInput,
  event: StructuredSignalEvent,
  scores: SignalScoreBreakdown,
  weightedScore: number,
  ageDays: number | null,
): string[] {
  const reasons = [
    `${event.event_type} signal scored ${weightedScore}/100 overall.`,
    `Fit ${scores.fit}/100 from lead relevance ${input.relevanceScore ?? 'unknown'}.`,
    `Outreachability ${scores.outreachability}/100 based on contact availability and verification.`,
    `Source reliability ${scores.source_reliability}/100 for ${event.source_name}.`,
  ]
  if (ageDays !== null) reasons.push(`Signal age is ${Math.round(ageDays)} day${Math.round(ageDays) === 1 ? '' : 's'}.`)
  if (input.relevanceReason) reasons.push(input.relevanceReason)
  return reasons.slice(0, 6)
}

function signalTypeQualityBoost(type: LeadSignalType): number {
  if (type === 'funding' || type === 'acquisition') return 8
  if (type === 'expansion' || type === 'regulation') return 5
  if (type === 'hiring') return 3
  return 0
}

function signalUrgencyBase(type: LeadSignalType): number {
  if (type === 'funding') return 78
  if (type === 'acquisition') return 82
  if (type === 'expansion') return 74
  if (type === 'regulation') return 70
  if (type === 'hiring') return 62
  return 48
}

function normalizeLeadScore(score: number | null | undefined): number {
  if (!Number.isFinite(score ?? NaN)) return 5
  return Math.max(0, Math.min(10, Number(score)))
}

function stableKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

function parseTime(value: string | null): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}
