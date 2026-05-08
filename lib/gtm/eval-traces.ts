import type { SupabaseClient } from '@supabase/supabase-js'

type EvalTraceStatus = 'passed' | 'blocked' | 'failed' | 'warning'
type EvalTraceType = 'manual_outreach_send' | 'automation_send' | 'followup_send' | 'policy_simulation' | 'draft_quality'

export function classifyFailureTaxonomy(input: {
  reasons?: string[] | null
  status: EvalTraceStatus
  errorMessage?: string | null
}): string | null {
  if (input.status === 'passed') return null
  const reasons = (input.reasons ?? []).map(reason => reason.toLowerCase())
  if (reasons.some(reason => reason.includes('recipient') || reason.includes('contact'))) return 'contact_quality'
  if (reasons.some(reason => reason.includes('unsubscribed') || reason.includes('bounced'))) return 'deliverability_guardrail'
  if (reasons.some(reason => reason.includes('blocked_company') || reason.includes('lead_status_'))) return 'policy_guardrail'
  if (reasons.some(reason => reason.includes('lead_locked') || reason.includes('no_credits'))) return 'commercial_gating'
  if (reasons.some(reason => reason.includes('rate_limit'))) return 'rate_limit'

  const message = (input.errorMessage ?? '').toLowerCase()
  if (message.includes('connected inbox') || message.includes('no sending account')) return 'inbox_config'
  if (message.includes('timeout') || message.includes('network') || message.includes('fetch')) return 'provider_transient'
  if (message) return 'runtime_error'
  return 'unknown'
}

export function scoreEvalTrace(input: {
  status: EvalTraceStatus
  reasons?: string[] | null
  draftQualityScore?: number | null
}): number {
  const quality = normalizeScore(input.draftQualityScore)
  if (input.status === 'passed') return clamp(Math.max(70, quality || 85))
  if (input.status === 'warning') return clamp(Math.min(69, quality || 60))
  const penalties = Math.min(40, (input.reasons ?? []).length * 10)
  const base = input.status === 'blocked' ? 48 : 35
  return clamp(base - penalties)
}

export async function upsertGtmEvalTrace(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    leadId?: string | null
    workflowRunId?: string | null
    traceType: EvalTraceType
    status: EvalTraceStatus
    reasons?: string[] | null
    errorMessage?: string | null
    draftQualityScore?: number | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  const reasons = (input.reasons ?? []).filter(Boolean)
  const failureTaxonomy = classifyFailureTaxonomy({
    reasons,
    status: input.status,
    errorMessage: input.errorMessage ?? null,
  })
  const score = scoreEvalTrace({
    status: input.status,
    reasons,
    draftQualityScore: input.draftQualityScore ?? null,
  })
  const row = {
    user_id: input.userId,
    client_id: input.clientId ?? null,
    lead_id: input.leadId ?? null,
    workflow_run_id: input.workflowRunId ?? null,
    trace_type: input.traceType,
    status: input.status,
    score,
    failure_taxonomy: failureTaxonomy,
    reasons,
    metadata: {
      ...(input.metadata ?? {}),
      error_message: input.errorMessage ?? null,
      draft_quality_score: input.draftQualityScore ?? null,
    },
  }

  if (input.workflowRunId) {
    const { error } = await supabase
      .from('gtm_eval_traces')
      .upsert(row, { onConflict: 'workflow_run_id,trace_type' })
    if (error) console.error('[gtm-eval-traces] upsert failed:', error.message)
    return
  }

  const { error } = await supabase.from('gtm_eval_traces').insert(row)
  if (error) console.error('[gtm-eval-traces] insert failed:', error.message)
}

function normalizeScore(value: number | null | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 0
  return Number(value)
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100))
}
