import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeDomain } from '@/lib/gtm/identity'

export interface OutboundPolicyInput {
  userId: string
  clientId?: string | null
  leadId?: string | null
  targetCompany: string
  companyDomain?: string | null
  status?: string | null
  isUnlocked?: boolean | null
  contactVerified?: boolean | null
  recipientValidationSafe?: boolean | null
  recipientEmails: string[]
  requireVerifiedContact?: boolean
  runId?: string | null
  stepId?: string | null
  agentRunId?: string | null
  metadata?: Record<string, unknown>
}

export interface OutboundPolicyDecision {
  decision: 'allowed' | 'blocked' | 'needs_approval'
  reasons: string[]
}

export async function evaluateOutboundPolicy(
  supabase: SupabaseClient,
  input: OutboundPolicyInput,
): Promise<OutboundPolicyDecision> {
  return resolveOutboundPolicyDecision(supabase, input, { persistDecision: true })
}

export async function simulateOutboundPolicy(
  supabase: SupabaseClient,
  input: OutboundPolicyInput,
): Promise<OutboundPolicyDecision> {
  return resolveOutboundPolicyDecision(supabase, input, { persistDecision: false })
}

async function resolveOutboundPolicyDecision(
  supabase: SupabaseClient,
  input: OutboundPolicyInput,
  options: { persistDecision: boolean },
): Promise<OutboundPolicyDecision> {
  const reasons: string[] = []
  const recipientEmails = [...new Set(input.recipientEmails.map(email => email.trim().toLowerCase()).filter(Boolean))]

  if (input.isUnlocked === false) reasons.push('lead_locked')
  if (!recipientEmails.length) reasons.push('missing_recipient')
  if (input.requireVerifiedContact && input.contactVerified !== true) reasons.push('contact_not_verified')
  if (input.recipientValidationSafe !== true) reasons.push('recipient_verification_required')
  if (input.status === 'replied' || input.status === 'booked' || input.status === 'dismissed') {
    reasons.push(`lead_status_${input.status}`)
  }

  const domain = normalizeDomain(input.companyDomain)
  const [blockedCompany, unsubscribed, bounced] = await Promise.all([
    findBlockedCompany(supabase, input.userId, input.targetCompany, domain),
    recipientEmails.length
      ? supabase.from('unsubscribed_emails').select('email').in('email', recipientEmails)
      : { data: [] },
    recipientEmails.length
      ? supabase.from('bounced_emails').select('email, reason').in('email', recipientEmails)
      : { data: [] },
  ])

  if (blockedCompany) reasons.push('blocked_company')
  if ((unsubscribed.data ?? []).length > 0) reasons.push('recipient_unsubscribed')
  if ((bounced.data ?? []).length > 0) reasons.push('recipient_bounced')

  const decision: OutboundPolicyDecision = {
    decision: reasons.length > 0 ? 'blocked' : 'allowed',
    reasons,
  }

  if (options.persistDecision) {
    await recordPolicyDecision(supabase, input, decision, {
      recipient_count: recipientEmails.length,
      blocked_company: blockedCompany,
      unsubscribed: unsubscribed.data ?? [],
      bounced: bounced.data ?? [],
      ...(input.metadata ?? {}),
    })
  }

  return decision
}

export async function recordPolicyDecision(
  supabase: SupabaseClient,
  input: OutboundPolicyInput,
  decision: OutboundPolicyDecision,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase.from('gtm_policy_decisions').insert({
    user_id: input.userId,
    client_id: input.clientId ?? null,
    run_id: input.runId ?? null,
    step_id: input.stepId ?? null,
    agent_run_id: input.agentRunId ?? null,
    lead_id: input.leadId ?? null,
    policy_name: 'outbound_safety_v1',
    action_type: 'send_email',
    decision: decision.decision,
    reasons: decision.reasons,
    input: {
      target_company: input.targetCompany,
      company_domain: input.companyDomain ?? null,
      status: input.status ?? null,
      require_verified_contact: input.requireVerifiedContact ?? false,
      recipient_validation_safe: input.recipientValidationSafe ?? null,
      recipient_count: input.recipientEmails.length,
    },
    metadata,
  })

  if (error) console.error('[outbound-policy] decision insert failed:', error.message)
}

async function findBlockedCompany(
  supabase: SupabaseClient,
  userId: string,
  companyName: string,
  domain: string | null,
): Promise<boolean> {
  let query = supabase
    .from('blocked_companies')
    .select('id')
    .eq('user_id', userId)
    .limit(1)

  if (domain) {
    query = query.eq('company_domain', domain)
  } else {
    query = query.ilike('company_name', companyName.trim())
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[outbound-policy] blocked company lookup failed:', error.message)
    return false
  }
  return Boolean(data?.id)
}
