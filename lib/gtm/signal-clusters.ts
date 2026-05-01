import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalIntelligence } from './signal-intelligence'

interface ClusterLookupQuery {
  eq(column: string, value: string): ClusterLookupQuery
  is(column: string, value: null): ClusterLookupQuery
  maybeSingle(): Promise<{
    data: { id?: string; signal_count?: number | string | null; first_observed_at?: string | null } | null
    error: { message: string } | null
  }>
}

export async function upsertSignalCluster(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    accountId: string
    signalId: string
    intelligence: SignalIntelligence
    observedAt?: string | null
  },
): Promise<void> {
  const observedAt = input.observedAt ?? input.intelligence.event.published_at ?? new Date().toISOString()
  const payload = {
    user_id: input.userId,
    client_id: input.clientId ?? null,
    account_id: input.accountId,
    cluster_key: input.intelligence.cluster_key,
    signal_type: input.intelligence.event.event_type,
    representative_signal_id: input.signalId,
    signal_count: 1,
    quality_score: input.intelligence.scores.quality,
    novelty_score: input.intelligence.scores.novelty,
    fit_score: input.intelligence.scores.fit,
    urgency_score: input.intelligence.scores.urgency,
    outreachability_score: input.intelligence.scores.outreachability,
    source_reliability_score: input.intelligence.scores.source_reliability,
    weighted_score: input.intelligence.weighted_score,
    attributes: {
      event: input.intelligence.event,
      duplicate_key: input.intelligence.duplicate_key,
      reasoning: input.intelligence.reasoning,
    },
    first_observed_at: observedAt,
    last_observed_at: observedAt,
  }

  let query = supabase
    .from('gtm_signal_clusters')
    .select('id, signal_count, first_observed_at')
    .eq('user_id', input.userId)
    .eq('cluster_key', input.intelligence.cluster_key) as unknown as ClusterLookupQuery
  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)
  const { data: existing, error: lookupError } = await query.maybeSingle()

  if (lookupError) {
    console.error('[signal-clusters] lookup failed:', lookupError.message)
    return
  }

  if (existing?.id) {
    const { error } = await supabase
      .from('gtm_signal_clusters')
      .update({
        ...payload,
        signal_count: Math.max(1, Number(existing.signal_count ?? 0) + 1),
        first_observed_at: existing.first_observed_at ?? observedAt,
        last_observed_at: observedAt,
      })
      .eq('id', existing.id)
    if (error) console.error('[signal-clusters] update failed:', error.message)
    return
  }

  const { error } = await supabase.from('gtm_signal_clusters').insert(payload)
  if (error) console.error('[signal-clusters] insert failed:', error.message)
}
