import type { SupabaseClient } from '@supabase/supabase-js'
import { eventIdempotencyKey, recordGtmEvent } from './events'

export type GtmMemoryScope = 'run' | 'entity' | 'workspace' | 'performance'

export interface RecordGtmMemoryInput {
  userId: string
  clientId?: string | null
  scope: GtmMemoryScope
  entityType?: string | null
  entityId?: string | null
  memoryType: string
  content: string
  source: string
  confidence?: number
  observedAt?: string | null
  expiresAt?: string | null
  provenance?: Record<string, unknown>
  agentRunId?: string | null
  workflowRunId?: string | null
}

export async function recordGtmMemory(
  supabase: SupabaseClient,
  input: RecordGtmMemoryInput,
): Promise<string | null> {
  const content = input.content.replace(/\s+/g, ' ').trim().slice(0, 4000)
  if (!content) return null

  const { data, error } = await supabase
    .from('gtm_memories')
    .insert({
      user_id: input.userId,
      client_id: input.clientId ?? null,
      memory_scope: input.scope,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      memory_type: input.memoryType.trim().slice(0, 80),
      content,
      source: input.source.trim().slice(0, 120),
      confidence: clampConfidence(input.confidence ?? 1),
      observed_at: input.observedAt ?? new Date().toISOString(),
      expires_at: input.expiresAt ?? null,
      provenance: input.provenance ?? {},
      created_by_agent_run_id: input.agentRunId ?? null,
      created_by_workflow_run_id: input.workflowRunId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[gtm-memory] insert failed:', error.message)
    return null
  }

  const memoryId = data?.id ?? null
  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    entityType: input.entityType ?? (memoryId ? 'memory' : null),
    entityId: input.entityId ?? memoryId,
    eventType: 'memory.recorded',
    eventTime: input.observedAt ?? new Date().toISOString(),
    source: input.source.trim().slice(0, 120),
    payload: {
      memory_id: memoryId,
      memory_scope: input.scope,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      memory_type: input.memoryType.trim().slice(0, 80),
      confidence: clampConfidence(input.confidence ?? 1),
      provenance: input.provenance ?? {},
      agent_run_id: input.agentRunId ?? null,
      workflow_run_id: input.workflowRunId ?? null,
    },
    idempotencyKey: eventIdempotencyKey(['memory', memoryId]),
  })

  return memoryId
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}
