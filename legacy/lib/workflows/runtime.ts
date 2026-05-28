import type { SupabaseClient } from '@supabase/supabase-js'
import { eventIdempotencyKey, recordGtmEvent } from '@/lib/gtm/events'

export type WorkflowStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
export type WorkflowStepStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'blocked'

export interface StartWorkflowRunInput {
  userId: string
  clientId?: string | null
  agentRunId?: string | null
  workflowType: string
  workflowKey?: string | null
  idempotencyKey?: string | null
  input?: Record<string, unknown>
}

export async function startWorkflowRun(
  supabase: SupabaseClient,
  input: StartWorkflowRunInput,
): Promise<string | null> {
  if (input.idempotencyKey) {
    const existing = await findWorkflowByIdempotencyKey(supabase, input.userId, input.clientId ?? null, input.idempotencyKey)
    if (existing?.id) return existing.id
  }

  const { data, error } = await supabase
    .from('gtm_workflow_runs')
    .insert({
      user_id: input.userId,
      client_id: input.clientId ?? null,
      agent_run_id: input.agentRunId ?? null,
      workflow_type: input.workflowType,
      workflow_key: input.workflowKey ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      status: 'running',
      input: input.input ?? {},
      checkpoint: {},
    })
    .select('id')
    .single()

  if (error) {
    console.error('[workflow-runtime] start failed:', error.message)
    return null
  }

  const runId = data?.id ?? null
  await recordGtmEvent(supabase, {
    userId: input.userId,
    clientId: input.clientId ?? null,
    entityType: runId ? 'workflow_run' : null,
    entityId: runId,
    eventType: 'workflow.started',
    source: 'workflow_runtime',
    payload: {
      workflow_type: input.workflowType,
      workflow_key: input.workflowKey ?? null,
      agent_run_id: input.agentRunId ?? null,
      input: input.input ?? {},
    },
    idempotencyKey: eventIdempotencyKey(['workflow', runId, 'started']),
  })

  return runId
}

export async function startWorkflowStep(
  supabase: SupabaseClient,
  input: {
    runId: string | null
    userId: string
    clientId?: string | null
    stepKey: string
    input?: Record<string, unknown>
    checkpoint?: Record<string, unknown>
  },
): Promise<string | null> {
  if (!input.runId) return null

  const existing = await findWorkflowStep(supabase, input.runId, input.stepKey)
  if (existing?.id) {
    const { error } = await supabase
      .from('gtm_workflow_steps')
      .update({
        status: 'running',
        input: input.input ?? {},
        checkpoint: input.checkpoint ?? {},
        started_at: new Date().toISOString(),
        completed_at: null,
        error_message: null,
      })
      .eq('id', existing.id)
    if (error) console.error('[workflow-runtime] step restart failed:', error.message)
    return existing.id
  }

  const { data, error } = await supabase
    .from('gtm_workflow_steps')
    .insert({
      run_id: input.runId,
      user_id: input.userId,
      client_id: input.clientId ?? null,
      step_key: input.stepKey,
      status: 'running',
      input: input.input ?? {},
      checkpoint: input.checkpoint ?? {},
    })
    .select('id')
    .single()

  if (error) {
    console.error('[workflow-runtime] step start failed:', error.message)
    return null
  }

  await updateWorkflowCheckpoint(supabase, {
    runId: input.runId,
    userId: input.userId,
    clientId: input.clientId ?? null,
    currentStep: input.stepKey,
    checkpoint: { current_step: input.stepKey },
  })

  return data?.id ?? null
}

export async function finishWorkflowStep(
  supabase: SupabaseClient,
  input: {
    stepId: string | null
    status: WorkflowStepStatus
    output?: Record<string, unknown>
    checkpoint?: Record<string, unknown>
    errorMessage?: string | null
  },
): Promise<void> {
  if (!input.stepId) return
  const { error } = await supabase
    .from('gtm_workflow_steps')
    .update({
      status: input.status,
      output: input.output ?? {},
      checkpoint: input.checkpoint ?? {},
      error_message: input.errorMessage ?? null,
      completed_at: ['completed', 'failed', 'skipped', 'blocked'].includes(input.status)
        ? new Date().toISOString()
        : null,
    })
    .eq('id', input.stepId)

  if (error) console.error('[workflow-runtime] step finish failed:', error.message)
}

export async function finishWorkflowRun(
  supabase: SupabaseClient,
  input: {
    runId: string | null
    status: WorkflowStatus
    output?: Record<string, unknown>
    checkpoint?: Record<string, unknown>
    errorMessage?: string | null
  },
): Promise<void> {
  if (!input.runId) return
  const terminal = ['completed', 'failed', 'cancelled'].includes(input.status)
  const { error } = await supabase
    .from('gtm_workflow_runs')
    .update({
      status: input.status,
      output: input.output ?? {},
      checkpoint: input.checkpoint ?? {},
      error_message: input.errorMessage ?? null,
      completed_at: terminal ? new Date().toISOString() : null,
    })
    .eq('id', input.runId)

  if (error) console.error('[workflow-runtime] run finish failed:', error.message)

  await recordGtmEvent(supabase, {
    entityType: 'workflow_run',
    entityId: input.runId,
    eventType: `workflow.${input.status}`,
    source: 'workflow_runtime',
    payload: {
      status: input.status,
      output: input.output ?? {},
      checkpoint: input.checkpoint ?? {},
      error_message: input.errorMessage ?? null,
    },
    idempotencyKey: eventIdempotencyKey(['workflow', input.runId, input.status]),
  })
}

export async function updateWorkflowCheckpoint(
  supabase: SupabaseClient,
  input: {
    runId: string | null
    userId: string
    clientId?: string | null
    stepId?: string | null
    currentStep?: string | null
    checkpoint: Record<string, unknown>
    checkpointKey?: string
  },
): Promise<void> {
  if (!input.runId) return
  const { error } = await supabase
    .from('gtm_workflow_runs')
    .update({
      current_step: input.currentStep ?? null,
      checkpoint: input.checkpoint,
    })
    .eq('id', input.runId)
  if (error) console.error('[workflow-runtime] checkpoint update failed:', error.message)

  const checkpointKey = input.checkpointKey ?? input.currentStep ?? 'checkpoint'
  const { error: checkpointError } = await supabase.from('gtm_agent_checkpoints').insert({
    run_id: input.runId,
    step_id: input.stepId ?? null,
    user_id: input.userId,
    client_id: input.clientId ?? null,
    checkpoint_key: checkpointKey,
    state: input.checkpoint,
  })
  if (checkpointError) console.error('[workflow-runtime] checkpoint insert failed:', checkpointError.message)
}

export async function recordToolCall(
  supabase: SupabaseClient,
  input: {
    runId?: string | null
    stepId?: string | null
    agentRunId?: string | null
    userId: string
    clientId?: string | null
    toolName: string
    status: 'running' | 'completed' | 'failed' | 'blocked'
    toolInput?: Record<string, unknown>
    output?: Record<string, unknown>
    errorMessage?: string | null
  },
): Promise<string | null> {
  const completedAt = input.status === 'running' ? null : new Date().toISOString()
  const { data, error } = await supabase
    .from('gtm_agent_tool_calls')
    .insert({
      run_id: input.runId ?? null,
      step_id: input.stepId ?? null,
      agent_run_id: input.agentRunId ?? null,
      user_id: input.userId,
      client_id: input.clientId ?? null,
      tool_name: input.toolName,
      status: input.status,
      input: input.toolInput ?? {},
      output: input.output ?? {},
      error_message: input.errorMessage ?? null,
      completed_at: completedAt,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[workflow-runtime] tool call insert failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function findWorkflowByIdempotencyKey(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
  idempotencyKey: string,
): Promise<{ id?: string } | null> {
  let query = supabase
    .from('gtm_workflow_runs')
    .select('id')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .limit(1)
  query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[workflow-runtime] idempotency lookup failed:', error.message)
    return null
  }
  return data as { id?: string } | null
}

async function findWorkflowStep(
  supabase: SupabaseClient,
  runId: string,
  stepKey: string,
): Promise<{ id?: string } | null> {
  const { data, error } = await supabase
    .from('gtm_workflow_steps')
    .select('id')
    .eq('run_id', runId)
    .eq('step_key', stepKey)
    .maybeSingle()
  if (error) {
    console.error('[workflow-runtime] step lookup failed:', error.message)
    return null
  }
  return data as { id?: string } | null
}
