import { NextResponse } from 'next/server'
import { getActiveClientContext } from '@/lib/client-context'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { activeClientId } = await getActiveClientContext(supabase, user.id)
  const clientFilter = activeClientId ? { client_id: activeClientId } : {}

  const [workflowRunsRes, policyDecisionsRes, memoriesRes, accountsRes] = await Promise.all([
    supabase
      .from('gtm_workflow_runs')
      .select('id, workflow_type, workflow_key, status, current_step, started_at, completed_at, error_message, input, output, checkpoint')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('started_at', { ascending: false })
      .limit(12),
    supabase
      .from('gtm_policy_decisions')
      .select('id, policy_name, action_type, decision, reasons, lead_id, decided_at, metadata')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('decided_at', { ascending: false })
      .limit(20),
    supabase
      .from('gtm_memories')
      .select('id, memory_scope, entity_type, entity_id, memory_type, content, source, confidence, observed_at, provenance')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('observed_at', { ascending: false })
      .limit(20),
    supabase
      .from('gtm_accounts')
      .select('id, name, domain, lifecycle_stage, last_seen_at, attributes')
      .eq('user_id', user.id)
      .match(clientFilter)
      .order('last_seen_at', { ascending: false })
      .limit(12),
  ])

  if (workflowRunsRes.error) return NextResponse.json({ error: workflowRunsRes.error.message }, { status: 500 })
  if (policyDecisionsRes.error) return NextResponse.json({ error: policyDecisionsRes.error.message }, { status: 500 })
  if (memoriesRes.error) return NextResponse.json({ error: memoriesRes.error.message }, { status: 500 })
  if (accountsRes.error) return NextResponse.json({ error: accountsRes.error.message }, { status: 500 })

  const workflowIds = (workflowRunsRes.data ?? []).map(row => row.id)
  const [stepsRes, toolCallsRes] = workflowIds.length > 0
    ? await Promise.all([
        supabase
          .from('gtm_workflow_steps')
          .select('id, run_id, step_key, status, attempt, started_at, completed_at, error_message, output')
          .in('run_id', workflowIds)
          .order('started_at', { ascending: false })
          .limit(60),
        supabase
          .from('gtm_agent_tool_calls')
          .select('id, run_id, step_id, tool_name, status, started_at, completed_at, error_message, output')
          .in('run_id', workflowIds)
          .order('started_at', { ascending: false })
          .limit(60),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  if (stepsRes.error) return NextResponse.json({ error: stepsRes.error.message }, { status: 500 })
  if (toolCallsRes.error) return NextResponse.json({ error: toolCallsRes.error.message }, { status: 500 })

  return NextResponse.json({
    workflow_runs: workflowRunsRes.data ?? [],
    workflow_steps: stepsRes.data ?? [],
    tool_calls: toolCallsRes.data ?? [],
    policy_decisions: policyDecisionsRes.data ?? [],
    memories: memoriesRes.data ?? [],
    accounts: accountsRes.data ?? [],
  })
}
