import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { recordGtmMemory } from './memory'
import { upsertLeadIntoGtmGraph } from './graph'
import { recordSourceReliabilityOutcome } from './source-reliability'

export type GtmOutcome = 'sent' | 'replied' | 'booked' | 'dismissed' | 'bounced' | 'unsubscribed'

export async function recordOutcomeLearning(
  supabase: SupabaseClient,
  input: {
    userId: string
    leadId: string
    outcome: GtmOutcome
    clientId?: string | null
    observedAt?: string | null
    metadata?: Record<string, unknown>
    agentRunId?: string | null
    workflowRunId?: string | null
  },
): Promise<void> {
  const observedAt = input.observedAt ?? new Date().toISOString()
  const { data: lead, error } = await supabase
    .from('leads')
    .select('id, user_id, client_id, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, contact_email, contact_name, contact_title, contact_verified, origin, source_kind, feed_snapshot, created_at, sent_at, replied_at, booked_at')
    .eq('id', input.leadId)
    .eq('user_id', input.userId)
    .maybeSingle()

  if (error || !lead) {
    if (error) console.error('[outcome-learning] lead lookup failed:', error.message)
    return
  }

  const graph = await upsertLeadIntoGtmGraph(supabase, lead, {
    agentRunId: input.agentRunId ?? null,
    workflowRunId: input.workflowRunId ?? null,
  })
  if (!graph) return

  const snapshot = normalizeLeadFeedSnapshot((lead as { feed_snapshot?: unknown }).feed_snapshot ?? null)
  const clientId = (lead as { client_id?: string | null }).client_id ?? input.clientId ?? null
  const sourceName = snapshot?.source_name ?? snapshot?.provider ?? (lead as { origin?: string | null }).origin ?? 'lead'
  const signalType = snapshot?.signal_type ?? 'unknown'
  const persona = inferPersona((lead as { contact_title?: string | null }).contact_title ?? null)
  const scoreDelta = outcomeScoreDelta(input.outcome)

  await recordGtmMemory(supabase, {
    userId: input.userId,
    clientId,
    scope: 'performance',
    memoryType: `outcome_${input.outcome}`,
    content: `${input.outcome} outcome for ${lead.target_company}; source=${sourceName}; signal=${signalType}; persona=${persona}; delta=${scoreDelta}.`,
    source: 'outcome_learning',
    confidence: 1,
    observedAt,
    provenance: {
      lead_id: input.leadId,
      account_id: graph.accountId,
      source_name: sourceName,
      signal_type: signalType,
      persona,
      score_delta: scoreDelta,
      ...(input.metadata ?? {}),
    },
    agentRunId: input.agentRunId ?? null,
    workflowRunId: input.workflowRunId ?? null,
  })

  await recordGtmMemory(supabase, {
    userId: input.userId,
    clientId,
    scope: 'entity',
    entityType: 'account',
    entityId: graph.accountId,
    memoryType: 'account_outcome_learning',
    content: `Learned from ${input.outcome}: ${sourceName}/${signalType} for ${persona} moved ranking by ${scoreDelta}.`,
    source: 'outcome_learning',
    confidence: 1,
    observedAt,
    provenance: {
      lead_id: input.leadId,
      outcome: input.outcome,
      source_name: sourceName,
      signal_type: signalType,
      persona,
      score_delta: scoreDelta,
    },
    agentRunId: input.agentRunId ?? null,
    workflowRunId: input.workflowRunId ?? null,
  })

  await mergeAccountLearning(supabase, graph.accountId, {
    last_outcome: input.outcome,
    last_outcome_at: observedAt,
    last_memory_update_at: observedAt,
    last_outreach_at: input.outcome === 'sent' ? observedAt : undefined,
    last_reply_at: input.outcome === 'replied' || input.outcome === 'booked' ? observedAt : undefined,
    source_learning: {
      source_name: sourceName,
      signal_type: signalType,
      persona,
      last_outcome: input.outcome,
      score_delta: scoreDelta,
      updated_at: observedAt,
    },
  })

  await recordSourceReliabilityOutcome(supabase, {
    userId: input.userId,
    clientId,
    sourceName,
    signalType,
    outcome: input.outcome,
    observedAt,
    metadata: {
      lead_id: input.leadId,
      account_id: graph.accountId,
      persona,
    },
  })
}

async function mergeAccountLearning(
  supabase: SupabaseClient,
  accountId: string,
  learning: Record<string, unknown>,
): Promise<void> {
  const { data: account, error } = await supabase
    .from('gtm_accounts')
    .select('attributes')
    .eq('id', accountId)
    .maybeSingle()
  if (error) {
    console.error('[outcome-learning] account lookup failed:', error.message)
    return
  }

  const existing = isRecord(account?.attributes) ? account.attributes : {}
  const checkpoints = isRecord(existing.agent_checkpoints) ? existing.agent_checkpoints : {}
  const nextCheckpoints = { ...checkpoints }
  for (const [key, value] of Object.entries(learning)) {
    if (value !== undefined && key !== 'source_learning') nextCheckpoints[key] = value
  }
  const sourceHistory = Array.isArray(existing.source_learning) ? existing.source_learning : []
  const nextAttributes = {
    ...existing,
    agent_checkpoints: nextCheckpoints,
    source_learning: [
      learning.source_learning,
      ...sourceHistory,
    ].filter(Boolean).slice(0, 20),
  }

  const { error: updateError } = await supabase
    .from('gtm_accounts')
    .update({ attributes: nextAttributes })
    .eq('id', accountId)
  if (updateError) console.error('[outcome-learning] account update failed:', updateError.message)
}

function outcomeScoreDelta(outcome: GtmOutcome): number {
  if (outcome === 'booked') return 18
  if (outcome === 'replied') return 10
  if (outcome === 'sent') return 2
  if (outcome === 'dismissed') return -6
  if (outcome === 'bounced') return -12
  return -16
}

function inferPersona(title: string | null | undefined): string {
  const value = (title ?? '').toLowerCase()
  if (value.includes('sales') || value.includes('revenue') || value.includes('growth')) return 'revenue'
  if (value.includes('marketing') || value.includes('demand')) return 'marketing'
  if (value.includes('founder') || value.includes('ceo') || value.includes('chief')) return 'executive'
  if (value.includes('people') || value.includes('talent') || value.includes('hr')) return 'people'
  return 'general_gtm'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
