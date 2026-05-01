import type { SupabaseClient } from '@supabase/supabase-js'

interface GetGtmAccountStateInput {
  userId: string
  clientId?: string | null
  accountId: string
}

export async function getGtmAccountState(
  supabase: SupabaseClient,
  input: GetGtmAccountStateInput,
) {
  const clientId = input.clientId ?? null
  let accountQuery = supabase
    .from('gtm_accounts')
    .select('id, client_id, account_key, name, domain, website_url, lifecycle_stage, source_kind, attributes, first_seen_at, last_seen_at, updated_at')
    .eq('user_id', input.userId)
    .eq('id', input.accountId)
  accountQuery = clientId ? accountQuery.eq('client_id', clientId) : accountQuery.is('client_id', null)

  const { data: account, error: accountError } = await accountQuery.maybeSingle()
  if (accountError) throw new Error(accountError.message)
  if (!account) return null

  let leadQuery = supabase
    .from('leads')
    .select('id, origin, source_kind, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, contact_email, contact_name, contact_title, created_at, sent_at, replied_at, booked_at, reply_intent, reply_summary, feed_snapshot')
    .eq('user_id', input.userId)
    .neq('status', 'dismissed')
    .order('created_at', { ascending: false })
    .limit(30)
  leadQuery = account.domain
    ? leadQuery.eq('company_domain', account.domain)
    : leadQuery.ilike('target_company', account.name)
  leadQuery = clientId ? leadQuery.eq('client_id', clientId) : leadQuery.is('client_id', null)

  const [peopleRes, signalsRes, touchpointsRes, memoriesRes, leadsRes] = await Promise.all([
    scopedQuery(
      supabase
        .from('gtm_people')
        .select('id, email, name, title, seniority, verified, source_kind, attributes, last_seen_at')
        .eq('user_id', input.userId)
        .eq('account_id', account.id)
        .order('last_seen_at', { ascending: false })
        .limit(30),
      clientId,
    ),
    scopedQuery(
      supabase
        .from('gtm_signals')
        .select('id, lead_id, signal_type, headline, summary, source_url, source_name, published_at, confidence, attributes, observed_at')
        .eq('user_id', input.userId)
        .eq('account_id', account.id)
        .order('observed_at', { ascending: false })
        .limit(30),
      clientId,
    ),
    scopedQuery(
      supabase
        .from('gtm_touchpoints')
        .select('id, lead_id, workflow_run_id, type, status, subject, body_preview, from_email, to_email, provider, occurred_at, metadata')
        .eq('user_id', input.userId)
        .eq('account_id', account.id)
        .order('occurred_at', { ascending: false })
        .limit(30),
      clientId,
    ),
    scopedQuery(
      supabase
        .from('gtm_memories')
        .select('id, memory_scope, entity_type, entity_id, memory_type, content, source, confidence, observed_at, expires_at, provenance')
        .eq('user_id', input.userId)
        .eq('entity_type', 'account')
        .eq('entity_id', account.id)
        .order('observed_at', { ascending: false })
        .limit(30),
      clientId,
    ),
    leadQuery,
  ])

  for (const res of [peopleRes, signalsRes, touchpointsRes, memoriesRes, leadsRes]) {
    if (res.error) throw new Error(res.error.message)
  }

  const leads = leadsRes.data ?? []
  const leadIds = leads.map(lead => lead.id)
  const [workflowRunsRes, policyDecisionsRes, outreachPlansRes] = leadIds.length > 0
    ? await Promise.all([
        scopedQuery(
          supabase
            .from('gtm_workflow_runs')
            .select('id, workflow_type, workflow_key, status, current_step, started_at, completed_at, error_message, checkpoint, output')
            .eq('user_id', input.userId)
            .in('workflow_key', leadIds)
            .order('started_at', { ascending: false })
            .limit(30),
          clientId,
        ),
        scopedQuery(
          supabase
            .from('gtm_policy_decisions')
            .select('id, run_id, lead_id, policy_name, action_type, decision, reasons, decided_at, metadata')
            .eq('user_id', input.userId)
            .in('lead_id', leadIds)
            .order('decided_at', { ascending: false })
            .limit(30),
          clientId,
        ),
        optionalRows(scopedQuery(
          supabase
            .from('gtm_outreach_plans')
            .select('id, lead_id, status, confidence, trigger, persona, angle, proof, risk_flags, created_at')
            .eq('user_id', input.userId)
            .in('lead_id', leadIds)
            .order('created_at', { ascending: false })
            .limit(30),
          clientId,
        )),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { rows: [] }]

  if (workflowRunsRes.error) throw new Error(workflowRunsRes.error.message)
  if (policyDecisionsRes.error) throw new Error(policyDecisionsRes.error.message)

  return {
    account,
    people: peopleRes.data ?? [],
    signals: signalsRes.data ?? [],
    touchpoints: touchpointsRes.data ?? [],
    memories: memoriesRes.data ?? [],
    leads,
    workflow_runs: workflowRunsRes.data ?? [],
    policy_decisions: policyDecisionsRes.data ?? [],
    outreach_plans: outreachPlansRes.rows,
    checkpoints: deriveCheckpoints(account.attributes),
    next_actions: deriveNextActions({
      leads,
      policyDecisions: policyDecisionsRes.data ?? [],
      workflowRuns: workflowRunsRes.data ?? [],
      checkpoints: deriveCheckpoints(account.attributes),
    }),
    state_health: {
      memory_count: memoriesRes.data?.length ?? 0,
      signal_count: signalsRes.data?.length ?? 0,
      person_count: peopleRes.data?.length ?? 0,
      touchpoint_count: touchpointsRes.data?.length ?? 0,
      last_seen_at: account.last_seen_at,
    },
  }
}

async function optionalRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[] }> {
  const result = await query
  if (result.error) {
    console.error('[account-state] optional table query failed:', result.error.message)
    return { rows: [] }
  }
  return { rows: result.data ?? [] }
}

function deriveNextActions(params: {
  leads: Array<Record<string, unknown>>
  policyDecisions: Array<Record<string, unknown>>
  workflowRuns: Array<Record<string, unknown>>
  checkpoints: Record<string, unknown>
}) {
  const actions: Array<{
    type: string
    label: string
    reason: string
    priority: number
    lead_id?: unknown
  }> = []

  for (const decision of params.policyDecisions) {
    if (decision.decision !== 'allowed') {
      actions.push({
        type: 'policy_review',
        label: 'Review guardrail',
        reason: Array.isArray(decision.reasons) ? decision.reasons.join(', ') : 'Policy requires review.',
        priority: 90,
        lead_id: decision.lead_id,
      })
    }
  }

  for (const run of params.workflowRuns) {
    if (run.status === 'failed') {
      actions.push({
        type: 'workflow_recovery',
        label: 'Review agent issue',
        reason: typeof run.error_message === 'string' && run.error_message ? run.error_message : 'Account work failed.',
        priority: 88,
      })
    }
  }

  for (const lead of params.leads) {
    if (lead.status === 'replied' || lead.replied_at) {
      actions.push({
        type: 'reply_followup',
        label: 'Handle reply',
        reason: typeof lead.reply_summary === 'string' && lead.reply_summary ? lead.reply_summary : 'Reply detected.',
        priority: 86,
        lead_id: lead.id,
      })
    } else if (lead.status === 'drafted' || (lead.is_unlocked === true && lead.contact_email && !lead.sent_at)) {
      actions.push({
        type: 'review_outreach_plan',
        label: 'Review next move',
        reason: typeof lead.contact_email === 'string' ? `Ready for ${lead.contact_email}.` : 'Ready for approval.',
        priority: 76,
        lead_id: lead.id,
      })
    }
  }

  if (typeof params.checkpoints.last_signal_at === 'string' && !params.leads.some(lead => lead.sent_at || lead.status === 'sent')) {
    actions.push({
      type: 'plan_first_touch',
      label: 'Plan first touch',
      reason: `Latest signal checkpoint: ${params.checkpoints.last_signal_type ?? 'signal'} at ${params.checkpoints.last_signal_at}.`,
      priority: 64,
    })
  }

  return actions.sort((a, b) => b.priority - a.priority).slice(0, 8)
}

function deriveCheckpoints(attributes: unknown): Record<string, unknown> {
  if (!isRecord(attributes)) return {}
  return isRecord(attributes.agent_checkpoints) ? attributes.agent_checkpoints : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function scopedQuery<T extends { eq: (column: string, value: string) => T; is: (column: string, value: null) => T }>(
  query: T,
  clientId: string | null,
): T {
  return clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
}
