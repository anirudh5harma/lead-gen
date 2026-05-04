import type { SupabaseClient } from '@supabase/supabase-js'
import { eventIdempotencyKey, recordGtmEvent } from './gtm/events'

export type AgentName =
  | 'research'
  | 'fit'
  | 'contact'
  | 'message'
  | 'safety'
  | 'sending'
  | 'reply'
  | 'booking'
  | 'followup'
  | 'crm_memory'
  | 'operator'

export type AgentEventStatus =
  | 'planned'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'blocked'
  | 'failed'
  | 'needs_approval'

export interface AgentEventInput {
  userId: string
  clientId?: string | null
  runId?: string | null
  leadId?: string | null
  agentName: AgentName
  eventType: string
  status: AgentEventStatus
  title: string
  body?: string | null
  metadata?: Record<string, unknown>
}

export async function recordAgentEvent(
  supabase: SupabaseClient,
  input: AgentEventInput,
): Promise<void> {
  const title = input.title.trim().slice(0, 180)
  if (!title) return

  const { error } = await supabase.from('agent_events').insert({
    user_id: input.userId,
    client_id: input.clientId ?? null,
    run_id: input.runId ?? null,
    lead_id: input.leadId ?? null,
    agent_name: input.agentName,
    event_type: input.eventType.trim().slice(0, 80),
    status: input.status,
    title,
    body: input.body?.trim().slice(0, 1000) || null,
    metadata: input.metadata ?? {},
  })

  if (error) {
    // Agent events are observability, not critical-path state.
    console.error('[agent-events] insert failed:', error.message)
  }

  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    entityType: input.leadId ? 'lead' : input.runId ? 'agent_run' : null,
    entityId: input.leadId ?? input.runId ?? null,
    eventType: `agent.${input.eventType.trim().slice(0, 80)}`,
    source: `agent:${input.agentName}`,
    payload: {
      run_id: input.runId ?? null,
      lead_id: input.leadId ?? null,
      agent_name: input.agentName,
      status: input.status,
      title,
      body: input.body?.trim().slice(0, 1000) || null,
      metadata: input.metadata ?? {},
    },
    idempotencyKey: eventIdempotencyKey(['agent', input.runId, input.leadId, input.eventType, input.status, title]),
  })
}

export async function startAgentRun(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    agentName: AgentName
    runType: string
    input?: Record<string, unknown>
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      user_id: input.userId,
      client_id: input.clientId ?? null,
      agent_name: input.agentName,
      run_type: input.runType,
      input: input.input ?? {},
      status: 'running',
    })
    .select('id')
    .single()

  if (error) {
    console.error('[agent-runs] start failed:', error.message)
    return null
  }

  return data?.id ?? null
}

export async function finishAgentRun(
  supabase: SupabaseClient,
  input: {
    runId: string | null
    status: 'completed' | 'failed' | 'cancelled'
    output?: Record<string, unknown>
    errorMessage?: string | null
  },
): Promise<void> {
  if (!input.runId) return

  const { error } = await supabase
    .from('agent_runs')
    .update({
      status: input.status,
      completed_at: new Date().toISOString(),
      output: input.output ?? {},
      error_message: input.errorMessage ?? null,
    })
    .eq('id', input.runId)

  if (error) console.error('[agent-runs] finish failed:', error.message)
}
