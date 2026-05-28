import type { SupabaseClient } from '@supabase/supabase-js'
import { classifySourceType, estimateSourceCost, type SourceType } from '@/lib/signal-filter'

export interface UpsertGtmSourceInput {
  userId?: string | null
  clientId?: string | null
  sourceKey?: string | null
  sourceName: string
  sourceType?: SourceType | string | null
  url?: string | null
  category?: string | null
  enabled?: boolean
  priority?: number
  pollFrequencyMinutes?: number
  attributes?: Record<string, unknown>
}

export async function upsertGtmSource(
  supabase: SupabaseClient,
  input: UpsertGtmSourceInput,
): Promise<string | null> {
  const label = input.sourceName.trim().slice(0, 180)
  if (!label) return null

  const sourceKey = normalizeSourceKey(input.sourceKey ?? label)
  const sourceType = (input.sourceType ?? classifySourceType(label)).toString().trim().slice(0, 80) || 'unknown'
  const now = new Date().toISOString()
  const row = {
    user_id: input.userId ?? null,
    client_id: input.clientId ?? null,
    source_key: sourceKey,
    source_type: sourceType,
    label,
    url: input.url ?? null,
    category: input.category ?? null,
    enabled: input.enabled ?? true,
    priority: clamp(input.priority ?? 50, 0, 100),
    poll_frequency_minutes: Math.max(1, Math.round(input.pollFrequencyMinutes ?? 720)),
    cost_model: {
      estimated_cost_per_item_usd: estimateSourceCost(label),
    },
    attributes: input.attributes ?? {},
    last_seen_at: now,
  }

  const existing = await findExistingSource(supabase, input.userId ?? null, input.clientId ?? null, sourceKey)
  if (existing?.id) {
    const { error } = await supabase
      .from('gtm_sources')
      .update({
        source_type: row.source_type,
        label: row.label,
        url: row.url,
        category: row.category,
        enabled: row.enabled,
        priority: row.priority,
        poll_frequency_minutes: row.poll_frequency_minutes,
        cost_model: row.cost_model,
        attributes: row.attributes,
        last_seen_at: row.last_seen_at,
      })
      .eq('id', existing.id)
    if (error) {
      console.error('[gtm-sources] update failed:', error.message)
      return null
    }
    return existing.id
  }

  const { data, error } = await supabase
    .from('gtm_sources')
    .insert(row)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[gtm-sources] upsert failed:', error.message)
    return null
  }

  return (data as { id?: string } | null)?.id ?? null
}

async function findExistingSource(
  supabase: SupabaseClient,
  userId: string | null,
  clientId: string | null,
  sourceKey: string,
): Promise<{ id: string } | null> {
  let query = supabase
    .from('gtm_sources')
    .select('id')
    .eq('source_key', sourceKey)
    .limit(1)

  query = userId ? query.eq('user_id', userId) : query.is('user_id', null)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[gtm-sources] lookup failed:', error.message)
    return null
  }
  return data as { id: string } | null
}

export function normalizeSourceKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'unknown'
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
