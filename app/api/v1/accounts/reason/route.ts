import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateAgent, scopeGuard } from '@/lib/a2a/agent-auth'
import { checkAgentRateLimit } from '@/lib/a2a/rate-limit'
import { consumeAgentCredit, getCostEstimate, finalizeTransaction } from '@/lib/a2a/cost-engine'
import { generateAuditHash, createAttestation, GUARDRAIL_TYPES } from '@/lib/a2a/audit'

// POST /api/v1/accounts/reason - reason about an account
export async function POST(request: Request) {
  const agent = await authenticateAgent(request)
  if (agent instanceof NextResponse) return agent

  const scopeCheck = scopeGuard(agent, 'read:accounts')
  if (scopeCheck) return scopeCheck

  const supabase = await createClient()

  const rateLimit = await checkAgentRateLimit(supabase, agent.apiKeyId, agent.rateLimitTier)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', reset_at: rateLimit.resetAt, window: rateLimit.window },
      { status: 429 },
    )
  }

  const body = await request.json().catch(() => null) as {
    company_domain?: string
    company_name?: string
    context?: string
  } | null

  if (!body?.company_domain) {
    return NextResponse.json({ error: 'company_domain is required' }, { status: 400 })
  }

  const cost = await getCostEstimate(supabase, 'account_reasoned')
  const tx = await consumeAgentCredit(supabase, agent.agentId, 'account_reasoned', 'bombsell.reason_account', body)

  if (!tx.success) {
    return NextResponse.json(
      { error: tx.error ?? 'Insufficient credits', balance: tx.balanceAfter },
      { status: 402 },
    )
  }

  // Fetch account data
  const { data: leads } = await supabase
    .from('leads')
    .select('id, target_company, company_domain, relevance_score, relevance_reason, status, created_at, contact_email, contact_name, contact_title, feed_snapshot')
    .eq('user_id', agent.userId)
    .ilike('company_domain', `%${body.company_domain}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  const lead = leads?.[0]

  // Build verdict
  const guardrails = [
    createAttestation(GUARDRAIL_TYPES.ICP_MATCHED, Boolean(lead && lead.relevance_score >= 7), {
      relevance_score: lead?.relevance_score ?? 0,
      threshold: 7,
    }),
    createAttestation(GUARDRAIL_TYPES.CONTACT_VERIFIED, Boolean(lead?.contact_email), {
      contact_found: Boolean(lead?.contact_email),
      name: lead?.contact_name ?? null,
      title: lead?.contact_title ?? null,
    }),
    createAttestation(GUARDRAIL_TYPES.TIMING_APPROPRIATE, Boolean(lead && new Date(lead.created_at) > new Date(Date.now() - 30 * 86400000)), {
      signal_age_days: lead ? Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000) : null,
    }),
  ]

  const allPassed = guardrails.every(g => g.passed)

  const verdict = {
    verdict: allPassed ? 'proceed' : 'hold',
    company_domain: body.company_domain,
    company_name: lead?.target_company ?? body.company_name ?? null,
    confidence: lead?.relevance_score ? lead.relevance_score / 10 : 0.5,
    scores: {
      timing: lead?.relevance_score ? Math.min(1, lead.relevance_score / 10 + 0.1) : 0.5,
      quality: lead?.relevance_score ? Math.min(1, lead.relevance_score / 10) : 0.5,
      accuracy: lead?.relevance_score ? Math.min(1, lead.relevance_score / 10 - 0.05) : 0.5,
    },
    why_now: lead ? {
      signal: lead.relevance_reason ?? 'Account matches ICP',
      trigger: 'icp_match',
      urgency: lead.relevance_score >= 8 ? 'high' : 'medium',
      expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    } : null,
    recommended_action: allPassed ? {
      type: 'outreach',
      persona: lead?.contact_title?.toLowerCase().includes('founder') || lead?.contact_title?.toLowerCase().includes('ceo') ? 'founder' : 'decision_maker',
      angle: 'timing_based',
      proof_point: lead?.relevance_reason ?? 'ICP match',
    } : null,
    verified_contact: lead?.contact_email ? {
      found: true,
      name: lead.contact_name,
      title: lead.contact_title,
      email: lead.contact_email,
    } : { found: false },
    guardrails_passed: guardrails,
    cost_basis: cost ? { action: cost.action, credits: cost.creditCost, unit: cost.unit } : null,
    balance_after: tx.balanceAfter,
    transaction_id: tx.transactionId,
  }

  const auditPayload = {
    transactionId: tx.transactionId!,
    agentId: agent.agentId,
    tool: 'bombsell.reason_account',
    action: 'account_reasoned',
    timestamp: new Date().toISOString(),
    cost: cost?.creditCost ?? 0,
    verdict: verdict.verdict,
    guardrails,
  }

  const auditHash = generateAuditHash(auditPayload)

  await finalizeTransaction(supabase, tx.transactionId!, 'completed', verdict, auditHash)

  return NextResponse.json({ ...verdict, audit_hash: auditHash })
}
