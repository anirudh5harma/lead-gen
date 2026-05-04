import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecordGtmEventInput {
  userId?: string | null
  clientId?: string | null
  entityType?: string | null
  entityId?: string | null
  eventType: string
  eventTime?: string | null
  source?: string | null
  payload?: Record<string, unknown>
  idempotencyKey?: string | null
}

export async function recordGtmEvent(
  supabase: SupabaseClient,
  input: RecordGtmEventInput,
): Promise<string | null> {
  const eventType = input.eventType.trim().slice(0, 120)
  if (!eventType) return null

  const source = input.source?.trim().slice(0, 120) || 'system'
  if (input.idempotencyKey) {
    const { data: existing, error: existingError } = await supabase
      .from('gtm_events')
      .select('id')
      .eq('source', source)
      .eq('event_type', eventType)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (existingError) console.error('[gtm-events] idempotency lookup failed:', existingError.message)
    if ((existing as { id?: string } | null)?.id) return (existing as { id?: string }).id ?? null
  }

  const { data, error } = await supabase
    .from('gtm_events')
    .insert({
      user_id: input.userId ?? null,
      client_id: input.clientId ?? null,
      entity_type: input.entityType?.trim().slice(0, 80) || null,
      entity_id: input.entityId ?? null,
      event_type: eventType,
      event_time: input.eventTime ?? new Date().toISOString(),
      source,
      payload: input.payload ?? {},
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('id')
    .maybeSingle()

  if (error && error.code !== '23505') {
    console.error('[gtm-events] insert failed:', error.message)
    return null
  }

  return (data as { id?: string } | null)?.id ?? null
}

export function eventIdempotencyKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .filter(part => part !== null && part !== undefined && String(part).trim().length > 0)
    .map(part => String(part).trim())
    .join(':')
    .slice(0, 240)
}
