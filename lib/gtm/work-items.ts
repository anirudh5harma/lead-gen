import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { accountKey, normalizeDomain, normalizeEntityName } from './identity'
import { buildSignalIntelligence } from './signal-intelligence'

export type GtmWorkItemType =
  | 'needs_approval'
  | 'reply_detected'
  | 'meeting_booked'
  | 'policy_blocked'
  | 'workflow_failed'
  | 'workflow_waiting'
  | 'new_opportunity'
  | 'sent_followup_pending'

export interface GtmWorkItem {
  id: string
  type: GtmWorkItemType
  status: 'open' | 'blocked' | 'waiting' | 'completed'
  priority: number
  title: string
  body: string
  account_name: string
  account_domain: string | null
  lead_id: string | null
  account_id: string | null
  workflow_run_id: string | null
  policy_decision_id: string | null
  action_label: string
  source: string
  created_at: string
  account_state_url: string | null
  metadata: Record<string, unknown>
}

interface ListGtmWorkItemsInput {
  userId: string
  clientId?: string | null
  limit?: number
}

interface LeadRow {
  id: string
  client_id: string | null
  target_company: string
  company_domain: string | null
  relevance_score: number | null
  relevance_reason: string | null
  status: string
  is_unlocked: boolean | null
  contact_email: string | null
  contact_name: string | null
  contact_title: string | null
  contact_verified: boolean | null
  created_at: string
  sent_at: string | null
  replied_at: string | null
  booked_at: string | null
  reply_intent: string | null
  reply_summary: string | null
  origin: string | null
  feed_snapshot: unknown
}

interface AccountRow {
  id: string
  name: string
  domain: string | null
}

interface PolicyDecisionRow {
  id: string
  lead_id: string | null
  decision: string
  reasons: string[] | null
  action_type: string
  decided_at: string
  metadata: Record<string, unknown> | null
}

interface WorkflowRunRow {
  id: string
  workflow_type: string
  workflow_key: string | null
  status: string
  current_step: string | null
  started_at: string
  error_message: string | null
  input: Record<string, unknown> | null
}

interface OutreachPlanRow {
  lead_id: string | null
  status: string
  confidence: number | null
  plan: Record<string, unknown> | null
  created_at: string
}

interface WorkItemActionRow {
  item_key: string
  action: string
}

export async function listGtmWorkItems(
  supabase: SupabaseClient,
  input: ListGtmWorkItemsInput,
): Promise<{ work_items: GtmWorkItem[] }> {
  const limit = clampLimit(input.limit ?? 30)
  const clientId = input.clientId ?? null
  const [leadsRes, accountsRes, policiesRes, workflowsRes, plansRes, actionRes] = await Promise.all([
    scopedQuery(
      supabase
        .from('leads')
        .select('id, client_id, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, contact_email, contact_name, contact_title, contact_verified, created_at, sent_at, replied_at, booked_at, reply_intent, reply_summary, origin, feed_snapshot')
        .eq('user_id', input.userId)
        .neq('status', 'dismissed')
        .order('created_at', { ascending: false })
        .limit(160),
      clientId,
    ),
    scopedQuery(
      supabase
        .from('gtm_accounts')
        .select('id, name, domain')
        .eq('user_id', input.userId)
        .order('last_seen_at', { ascending: false })
        .limit(250),
      clientId,
    ),
    scopedQuery(
      supabase
        .from('gtm_policy_decisions')
        .select('id, lead_id, decision, reasons, action_type, decided_at, metadata')
        .eq('user_id', input.userId)
        .neq('decision', 'allowed')
        .order('decided_at', { ascending: false })
        .limit(50),
      clientId,
    ),
    scopedQuery(
      supabase
        .from('gtm_workflow_runs')
        .select('id, workflow_type, workflow_key, status, current_step, started_at, error_message, input')
        .eq('user_id', input.userId)
        .in('status', ['running', 'waiting', 'failed'])
        .order('started_at', { ascending: false })
        .limit(50),
      clientId,
    ),
    optionalRows(scopedQuery(
      supabase
        .from('gtm_outreach_plans')
        .select('lead_id, status, confidence, plan, created_at')
        .eq('user_id', input.userId)
        .order('created_at', { ascending: false })
        .limit(120),
      clientId,
    )),
    optionalRows(scopedQuery(
      supabase
        .from('gtm_work_item_actions')
        .select('item_key, action')
        .eq('user_id', input.userId)
        .in('action', ['reviewed', 'approved', 'discussed', 'dismissed'])
        .order('created_at', { ascending: false })
        .limit(500),
      clientId,
    )),
  ])

  for (const res of [leadsRes, accountsRes, policiesRes, workflowsRes]) {
    if (res.error) throw new Error(res.error.message)
  }

  const leads = (leadsRes.data ?? []) as LeadRow[]
  const leadById = new Map(leads.map(lead => [lead.id, lead]))
  const accountByKey = buildAccountIndex((accountsRes.data ?? []) as AccountRow[])
  const planByLead = latestPlanByLead(plansRes.rows)
  const closedItemKeys = new Set((actionRes.rows as WorkItemActionRow[]).map(row => row.item_key))
  const items: GtmWorkItem[] = []

  for (const lead of leads) {
    const account = findAccountForLead(accountByKey, lead)
    const signalIntel = getLeadSignalIntelligence(lead)
    const outreachPlan = planByLead.get(lead.id) ?? null
    const signalBoost = signalIntel ? Math.round((signalIntel.weighted_score - 50) / 5) : 0
    if (lead.status === 'booked' || lead.booked_at) {
      items.push(leadItem('meeting_booked', lead, account, {
        priority: 96,
        status: 'completed',
        title: `Meeting booked with ${lead.target_company}`,
        body: lead.reply_summary ?? 'This account converted into a meeting. Review the account history and learning signal.',
        actionLabel: 'Review outcome',
        createdAt: lead.booked_at ?? lead.replied_at ?? lead.created_at,
      }))
      continue
    }

    if (lead.status === 'replied' || lead.replied_at) {
      items.push(leadItem('reply_detected', lead, account, {
        priority: lead.reply_intent === 'meeting_requested' ? 94 : 86,
        title: `${lead.target_company} replied`,
        body: lead.reply_summary ?? 'Reply received. Decide the next best step for this account.',
        actionLabel: 'Handle reply',
        createdAt: lead.replied_at ?? lead.created_at,
      }))
      continue
    }

    if (lead.status === 'drafted' || (lead.status !== 'viewed' && lead.is_unlocked === true && Boolean(lead.contact_email) && !lead.sent_at)) {
      items.push(leadItem('needs_approval', lead, account, {
        priority: 78 + Math.min(12, Math.max(0, (lead.relevance_score ?? 0) - 7) * 3) + signalBoost,
        title: `Next move ready for ${lead.target_company}`,
        body: lead.contact_email
          ? `${lead.contact_email} is ready for approve-first outreach.`
          : lead.relevance_reason ?? 'This account is ready for review.',
        actionLabel: 'Review next move',
        metadata: {
          ...(signalIntel ? { signal_intelligence: signalIntel } : {}),
          ...(outreachPlan ? { outreach_plan: outreachPlan.plan, outreach_plan_status: outreachPlan.status, outreach_plan_confidence: outreachPlan.confidence } : {}),
        },
      }))
      continue
    }

    if (lead.sent_at && !lead.replied_at) {
      items.push(leadItem('sent_followup_pending', lead, account, {
        priority: 52,
        status: 'waiting',
        title: `${lead.target_company} is waiting on follow-up`,
        body: 'Initial outreach was sent. Bombsell will keep the account in view unless a reply arrives.',
        actionLabel: 'Inspect account',
        createdAt: lead.sent_at,
      }))
      continue
    }

    if (lead.status !== 'viewed' && (lead.relevance_score ?? 0) >= 8) {
      items.push(leadItem('new_opportunity', lead, account, {
        priority: 62 + Math.min(18, (lead.relevance_score ?? 0) * 2) + signalBoost,
        title: `In-market account: ${lead.target_company}`,
        body: signalIntel
          ? `${signalIntel.event.event_type} movement scored ${signalIntel.weighted_score}/100.`
          : lead.relevance_reason ?? 'New high-fit account surfaced by Bombsell.',
        actionLabel: 'Inspect account',
        metadata: {
          ...(signalIntel ? { signal_intelligence: signalIntel } : {}),
          ...(outreachPlan ? { outreach_plan: outreachPlan.plan, outreach_plan_status: outreachPlan.status, outreach_plan_confidence: outreachPlan.confidence } : {}),
        },
      }))
    }
  }

  for (const decision of (policiesRes.data ?? []) as PolicyDecisionRow[]) {
    const lead = decision.lead_id ? leadById.get(decision.lead_id) ?? null : null
    const account = lead ? findAccountForLead(accountByKey, lead) : null
    items.push({
      id: `policy:${decision.id}`,
      type: 'policy_blocked',
      status: decision.decision === 'blocked' ? 'blocked' : 'waiting',
      priority: decision.decision === 'blocked' ? 88 : 72,
      title: `Guardrail ${decision.decision}`,
      body: (decision.reasons ?? []).join(', ') || 'A safety rule requires review before execution.',
      account_name: lead?.target_company ?? 'Workspace policy',
      account_domain: lead?.company_domain ?? null,
      lead_id: lead?.id ?? decision.lead_id,
      account_id: account?.id ?? null,
      workflow_run_id: null,
      policy_decision_id: decision.id,
      action_label: 'Review guardrail',
      source: 'guardrail',
      created_at: decision.decided_at,
      account_state_url: account ? `/api/gtm/accounts/${account.id}/state` : null,
      metadata: decision.metadata ?? {},
    })
  }

  for (const run of (workflowsRes.data ?? []) as WorkflowRunRow[]) {
    const leadId = leadIdFromRun(run)
    const lead = leadId ? leadById.get(leadId) ?? null : null
    const account = lead ? findAccountForLead(accountByKey, lead) : null
    items.push({
      id: `workflow:${run.id}`,
      type: run.status === 'failed' ? 'workflow_failed' : 'workflow_waiting',
      status: run.status === 'failed' ? 'blocked' : 'waiting',
      priority: run.status === 'failed' ? 92 : 58,
      title: `Account work ${run.status}`,
      body: run.error_message ?? (run.current_step ? `Current step: ${run.current_step.replace(/_/g, ' ')}` : 'Account work is active.'),
      account_name: lead?.target_company ?? 'Account agent',
      account_domain: lead?.company_domain ?? null,
      lead_id: lead?.id ?? leadId,
      account_id: account?.id ?? null,
      workflow_run_id: run.id,
      policy_decision_id: null,
      action_label: run.status === 'failed' ? 'Review issue' : 'Inspect',
      source: 'agent',
      created_at: run.started_at,
      account_state_url: account ? `/api/gtm/accounts/${account.id}/state` : null,
      metadata: { workflow_type: run.workflow_type, current_step: run.current_step },
    })
  }

  return {
    work_items: dedupeItems(items)
      .filter(item => !closedItemKeys.has(item.id))
      .sort((a, b) => b.priority - a.priority || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit),
  }
}

function leadItem(
  type: GtmWorkItemType,
  lead: LeadRow,
  account: AccountRow | null,
  options: {
    priority: number
    title: string
    body: string
    actionLabel: string
    status?: GtmWorkItem['status']
    createdAt?: string
    metadata?: Record<string, unknown>
  },
): GtmWorkItem {
  return {
    id: `lead:${lead.id}:${type}`,
    type,
    status: options.status ?? 'open',
    priority: options.priority,
    title: options.title,
    body: options.body,
    account_name: lead.target_company,
    account_domain: lead.company_domain,
    lead_id: lead.id,
    account_id: account?.id ?? null,
    workflow_run_id: null,
    policy_decision_id: null,
    action_label: options.actionLabel,
    source: lead.origin ?? 'lead',
    created_at: options.createdAt ?? lead.created_at,
    account_state_url: account ? `/api/gtm/accounts/${account.id}/state` : null,
    metadata: {
      relevance_score: lead.relevance_score,
      contact_email: lead.contact_email,
      contact_name: lead.contact_name,
      contact_title: lead.contact_title,
      ...(options.metadata ?? {}),
    },
  }
}

function buildAccountIndex(accounts: AccountRow[]) {
  const byDomain = new Map<string, AccountRow>()
  const byName = new Map<string, AccountRow>()
  for (const account of accounts) {
    if (account.domain) byDomain.set(normalizeKey(account.domain), account)
    byName.set(normalizeKey(account.name), account)
  }
  return { byDomain, byName }
}

function findAccountForLead(index: ReturnType<typeof buildAccountIndex>, lead: LeadRow): AccountRow | null {
  if (lead.company_domain) {
    const byDomain = index.byDomain.get(normalizeKey(lead.company_domain))
    if (byDomain) return byDomain
  }
  return index.byName.get(normalizeKey(lead.target_company)) ?? null
}

function leadIdFromRun(run: WorkflowRunRow): string | null {
  if (run.workflow_key && /^[0-9a-f-]{20,}$/i.test(run.workflow_key)) return run.workflow_key
  const raw = run.input?.lead_id
  return typeof raw === 'string' ? raw : null
}

function dedupeItems(items: GtmWorkItem[]): GtmWorkItem[] {
  const seen = new Set<string>()
  const result: GtmWorkItem[] = []
  for (const item of items) {
    const key = `${item.type}:${item.lead_id ?? item.workflow_run_id ?? item.policy_decision_id ?? item.id}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

async function optionalRows<T>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[] }> {
  const result = await query
  if (result.error) {
    console.error('[gtm-work-items] optional table query failed:', result.error.message)
    return { rows: [] }
  }
  return { rows: result.data ?? [] }
}

function latestPlanByLead(rows: OutreachPlanRow[]): Map<string, OutreachPlanRow> {
  const map = new Map<string, OutreachPlanRow>()
  for (const row of rows) {
    if (!row.lead_id || map.has(row.lead_id)) continue
    map.set(row.lead_id, row)
  }
  return map
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[^a-z0-9.]+/g, '').trim()
}

function getLeadSignalIntelligence(lead: LeadRow) {
  const snapshot = normalizeLeadFeedSnapshot(lead.feed_snapshot)
  const companyName = normalizeEntityName(lead.target_company)
  if (!snapshot || !companyName) return null
  const domain = normalizeDomain(lead.company_domain ?? snapshot.company_domain ?? null)
  return buildSignalIntelligence({
    leadId: lead.id,
    accountKey: accountKey({ name: companyName, domain }),
    targetCompany: companyName,
    companyDomain: domain,
    relevanceScore: lead.relevance_score,
    relevanceReason: lead.relevance_reason,
    contactEmail: lead.contact_email,
    contactVerified: lead.contact_verified,
    createdAt: lead.created_at,
    snapshot,
  })
}

function scopedQuery<T extends { eq: (column: string, value: string) => T; is: (column: string, value: null) => T }>(
  query: T,
  clientId: string | null,
): T {
  return clientId ? query.eq('client_id', clientId) : query.is('client_id', null)
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 30
  return Math.max(1, Math.min(100, Math.round(value)))
}
