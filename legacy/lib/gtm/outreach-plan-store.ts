import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutreachPlan } from './outreach-plan'

export async function persistOutreachPlan(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId?: string | null
    leadId: string
    accountId?: string | null
    personId?: string | null
    plan: OutreachPlan
    status?: 'planned' | 'needs_review' | 'approved' | 'blocked' | 'sent' | 'dismissed'
    agentRunId?: string | null
    workflowRunId?: string | null
  },
): Promise<string | null> {
  const status = input.status ?? (input.plan.requires_review ? 'needs_review' : 'planned')
  const { data, error } = await supabase
    .from('gtm_outreach_plans')
    .insert({
      user_id: input.userId,
      client_id: input.clientId ?? null,
      lead_id: input.leadId,
      account_id: input.accountId ?? null,
      person_id: input.personId ?? null,
      plan_version: input.plan.version,
      status,
      confidence: input.plan.confidence,
      trigger: input.plan.trigger,
      persona: input.plan.persona,
      angle: input.plan.angle,
      proof: input.plan.proof,
      safety_checks: input.plan.safety_checks,
      risk_flags: input.plan.risk_flags,
      plan: input.plan,
      created_by_workflow_run_id: input.workflowRunId ?? null,
      created_by_agent_run_id: input.agentRunId ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[outreach-plan-store] insert failed:', error.message)
    return null
  }
  return data?.id ?? null
}

export async function markLatestOutreachPlanStatus(
  supabase: SupabaseClient,
  input: {
    userId: string
    leadId: string
    status: 'planned' | 'needs_review' | 'approved' | 'blocked' | 'sent' | 'dismissed'
  },
): Promise<void> {
  const { data, error } = await supabase
    .from('gtm_outreach_plans')
    .select('id')
    .eq('user_id', input.userId)
    .eq('lead_id', input.leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data?.id) {
    if (error) console.error('[outreach-plan-store] lookup failed:', error.message)
    return
  }
  const { error: updateError } = await supabase
    .from('gtm_outreach_plans')
    .update({ status: input.status })
    .eq('id', data.id)
  if (updateError) console.error('[outreach-plan-store] status update failed:', updateError.message)
}
