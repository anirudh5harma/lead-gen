import type { SupabaseClient } from '@supabase/supabase-js'
import { eventIdempotencyKey, recordGtmEvent } from './events'

export type GtmActionStatus = 'open' | 'waiting' | 'blocked' | 'completed' | 'dismissed' | 'failed'

export interface UpsertGtmActionInput {
  userId: string
  clientId?: string | null
  accountId?: string | null
  leadId?: string | null
  workflowRunId?: string | null
  actionType: string
  channel?: string | null
  title: string
  body?: string | null
  priority?: number
  status?: GtmActionStatus
  dueAt?: string | null
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  source?: string | null
  sourceItemKey?: string | null
  completedAt?: string | null
}

export async function upsertGtmAction(
  supabase: SupabaseClient,
  input: UpsertGtmActionInput,
): Promise<string | null> {
  const title = input.title.trim().slice(0, 180)
  const actionType = input.actionType.trim().slice(0, 100)
  if (!title || !actionType) return null

  const status = input.status ?? 'open'
  const completedAt = input.completedAt ?? (['completed', 'dismissed', 'failed'].includes(status) ? new Date().toISOString() : null)
  const row = {
    user_id: input.userId,
    client_id: input.clientId ?? null,
    account_id: input.accountId ?? null,
    lead_id: input.leadId ?? null,
    workflow_run_id: input.workflowRunId ?? null,
    action_type: actionType,
    channel: input.channel?.trim().slice(0, 80) || 'workspace',
    title,
    body: input.body?.trim().slice(0, 1200) || null,
    priority: clamp(input.priority ?? 50, 0, 100),
    status,
    due_at: input.dueAt ?? null,
    payload: input.payload ?? {},
    result: input.result ?? {},
    source: input.source?.trim().slice(0, 120) || 'system',
    source_item_key: input.sourceItemKey ?? null,
    completed_at: completedAt,
  }

  const existing = input.sourceItemKey
    ? await findExistingAction(supabase, input.userId, input.clientId ?? null, input.sourceItemKey)
    : null

  const { data, error } = existing?.id
    ? await supabase
        .from('gtm_actions')
        .update({
          account_id: row.account_id,
          lead_id: row.lead_id,
          workflow_run_id: row.workflow_run_id,
          action_type: row.action_type,
          channel: row.channel,
          title: row.title,
          body: row.body,
          priority: row.priority,
          status: row.status,
          due_at: row.due_at,
          payload: row.payload,
          result: row.result,
          source: row.source,
          completed_at: row.completed_at,
        })
        .eq('id', existing.id)
        .select('id')
        .maybeSingle()
    : await supabase.from('gtm_actions').insert(row).select('id').maybeSingle()

  if (error && error.code !== '23505') {
    console.error('[gtm-actions] upsert failed:', error.message)
    return null
  }

  const actionId = (data as { id?: string } | null)?.id ?? null
  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    entityType: actionId ? 'action' : input.leadId ? 'lead' : null,
    entityId: actionId ?? input.leadId ?? null,
    eventType: `action.${status}`,
    source: row.source,
    payload: {
      action_id: actionId,
      action_type: actionType,
      lead_id: input.leadId ?? null,
      account_id: input.accountId ?? null,
      source_item_key: input.sourceItemKey ?? null,
    },
    idempotencyKey: eventIdempotencyKey(['action', status, input.sourceItemKey ?? actionId]),
  })

  return actionId
}

async function findExistingAction(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
  sourceItemKey: string,
): Promise<{ id: string } | null> {
  let query = supabase
    .from('gtm_actions')
    .select('id')
    .eq('user_id', userId)
    .eq('source_item_key', sourceItemKey)
    .limit(1)

  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[gtm-actions] lookup failed:', error.message)
    return null
  }
  return data as { id: string } | null
}

export async function completeGtmActionForSourceItem(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    sourceItemKey: string
    result?: Record<string, unknown>
    status?: Extract<GtmActionStatus, 'completed' | 'dismissed' | 'failed'>
  },
): Promise<void> {
  let query = supabase
    .from('gtm_actions')
    .update({
      status: input.status ?? 'completed',
      result: input.result ?? {},
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('source_item_key', input.sourceItemKey)

  query = input.clientId ? query.eq('client_id', input.clientId) : query.is('client_id', null)
  const { error } = await query
  if (error) console.error('[gtm-actions] complete failed:', error.message)
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}
