import type { SupabaseClient } from '@supabase/supabase-js'
import type { GtmOutcome } from './outcome-learning'

interface ReliabilityLookupQuery {
  eq(column: string, value: string): ReliabilityLookupQuery
  is(column: string, value: null): ReliabilityLookupQuery
  maybeSingle(): Promise<{
    data: {
      id?: string
      signal_count?: number | string | null
      sent_count?: number | string | null
      replied_count?: number | string | null
      booked_count?: number | string | null
      dismissed_count?: number | string | null
      bounced_count?: number | string | null
      unsubscribed_count?: number | string | null
    } | null
    error: { message: string } | null
  }>
}

export async function recordSourceReliabilityOutcome(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    sourceName: string
    signalType?: string | null
    outcome: GtmOutcome | 'signal'
    observedAt?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const sourceKey = normalizeSourceKey(input.sourceName)
  const signalType = input.signalType ?? null
  const observedAt = input.observedAt ?? new Date().toISOString()
  let existingQuery = supabase
    .from('gtm_source_reliability')
    .select('id, signal_count, sent_count, replied_count, booked_count, dismissed_count, bounced_count, unsubscribed_count')
    .eq('user_id', input.userId)
    .eq('source_key', sourceKey) as unknown as ReliabilityLookupQuery

  existingQuery = signalType ? existingQuery.eq('signal_type', signalType) : existingQuery.is('signal_type', null)
  existingQuery = input.clientId ? existingQuery.eq('client_id', input.clientId) : existingQuery.is('client_id', null)
  const { data: existing, error: lookupError } = await existingQuery.maybeSingle()

  if (lookupError) {
    console.error('[source-reliability] lookup failed:', lookupError.message)
    return
  }

  const counts = {
    signal_count: Number(existing?.signal_count ?? 0) + (input.outcome === 'signal' ? 1 : 0),
    sent_count: Number(existing?.sent_count ?? 0) + (input.outcome === 'sent' ? 1 : 0),
    replied_count: Number(existing?.replied_count ?? 0) + (input.outcome === 'replied' ? 1 : 0),
    booked_count: Number(existing?.booked_count ?? 0) + (input.outcome === 'booked' ? 1 : 0),
    dismissed_count: Number(existing?.dismissed_count ?? 0) + (input.outcome === 'dismissed' ? 1 : 0),
    bounced_count: Number(existing?.bounced_count ?? 0) + (input.outcome === 'bounced' ? 1 : 0),
    unsubscribed_count: Number(existing?.unsubscribed_count ?? 0) + (input.outcome === 'unsubscribed' ? 1 : 0),
  }
  const reliabilityScore = computeReliability(counts)
  const payload = {
    user_id: input.userId,
    client_id: input.clientId ?? null,
    source_key: sourceKey,
    source_name: input.sourceName,
    signal_type: signalType,
    ...counts,
    reliability_score: reliabilityScore,
    last_outcome: input.outcome,
    last_observed_at: observedAt,
    attributes: input.metadata ?? {},
  }

  if (existing?.id) {
    const { error } = await supabase.from('gtm_source_reliability').update(payload).eq('id', existing.id)
    if (error) console.error('[source-reliability] update failed:', error.message)
    return
  }

  const { error } = await supabase.from('gtm_source_reliability').insert(payload)
  if (error) console.error('[source-reliability] insert failed:', error.message)
}

function computeReliability(counts: {
  signal_count: number
  sent_count: number
  replied_count: number
  booked_count: number
  dismissed_count: number
  bounced_count: number
  unsubscribed_count: number
}): number {
  const positive = counts.sent_count * 2 + counts.replied_count * 8 + counts.booked_count * 18
  const negative = counts.dismissed_count * 5 + counts.bounced_count * 10 + counts.unsubscribed_count * 14
  const volume = Math.min(12, Math.round(Math.sqrt(Math.max(0, counts.signal_count))))
  return Math.max(0, Math.min(100, Math.round(60 + volume + positive - negative)))
}

function normalizeSourceKey(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'unknown'
}
