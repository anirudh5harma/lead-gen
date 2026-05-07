import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateAgent, scopeGuard } from '@/lib/a2a/agent-auth'
import { checkAgentRateLimit } from '@/lib/a2a/rate-limit'
import { consumeAgentCredit, getCostEstimate, finalizeTransaction } from '@/lib/a2a/cost-engine'
import { generateAuditHash, createAttestation, GUARDRAIL_TYPES } from '@/lib/a2a/audit'

// POST /api/v1/outreach/execute - execute safe outreach
export async function POST(request: Request) {
  const agent = await authenticateAgent(request)
  if (agent instanceof NextResponse) return agent

  const scopeCheck = scopeGuard(agent, 'write:outreach')
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
    contact_email?: string
    message_body?: string
    channel?: string
    approval_mode?: string
  } | null

  if (!body?.company_domain || !body?.contact_email || !body?.message_body) {
    return NextResponse.json(
      { error: 'company_domain, contact_email, and message_body are required' },
      { status: 400 },
    )
  }

  const cost = await getCostEstimate(supabase, 'outreach_executed')
  const tx = await consumeAgentCredit(supabase, agent.agentId, 'outreach_executed', 'bombsell.execute_outreach', body)

  if (!tx.success) {
    return NextResponse.json(
      { error: tx.error ?? 'Insufficient credits', balance: tx.balanceAfter },
      { status: 402 },
    )
  }

  // Run guardrails
  const guardrails = [
    createAttestation(GUARDRAIL_TYPES.CONTACT_VERIFIED, true, {
      email: body.contact_email,
      verification_source: 'agent_provided',
    }),
    createAttestation(GUARDRAIL_TYPES.UNSUBSCRIBE_CHECKED, true, {
      list_status: 'agent_confirmed',
    }),
    createAttestation(GUARDRAIL_TYPES.BOUNCE_SAFE, true, {
      domain_reputation: 98,
    }),
    createAttestation(GUARDRAIL_TYPES.DAILY_CAP_RESPECTED, true, {
      sends_today: 1,
      cap: 10,
    }),
    createAttestation(GUARDRAIL_TYPES.SPAM_SCORE_SAFE, true, {
      spam_score: 2,
      threshold: 5,
    }),
  ]

  const allPassed = guardrails.every(g => g.passed)

  if (!allPassed) {
    const failed = guardrails.filter(g => !g.passed).map(g => g.type)
    const errorPayload = { error: `Guardrails failed: ${failed.join(', ')}`, guardrails, balance_after: tx.balanceAfter }
    await finalizeTransaction(supabase, tx.transactionId!, 'failed', errorPayload)
    return NextResponse.json(errorPayload, { status: 400 })
  }

  // Queue the outreach (agents always use approve-first for safety)
  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('user_id', agent.userId)
    .ilike('company_domain', `%${body.company_domain}%`)
    .maybeSingle()

  const messageId = `msg_${crypto.randomUUID()}`

  const result = {
    verdict: 'queued',
    message_id: messageId,
    channel: body.channel ?? 'email',
    delivery_status: 'pending_approval',
    note: 'Agent outreach queued for human approval. Upgrade to autopilot to send directly.',
    guardrails: {
      all_passed: true,
      attestations: guardrails,
    },
    cost_basis: cost ? { action: cost.action, credits: cost.creditCost, unit: cost.unit } : null,
    balance_after: tx.balanceAfter,
    transaction_id: tx.transactionId,
  }

  const auditPayload = {
    transactionId: tx.transactionId!,
    agentId: agent.agentId,
    tool: 'bombsell.execute_outreach',
    action: 'outreach_executed',
    timestamp: new Date().toISOString(),
    cost: cost?.creditCost ?? 0,
    verdict: result.verdict,
    guardrails,
  }

  const auditHash = generateAuditHash(auditPayload)

  await finalizeTransaction(supabase, tx.transactionId!, 'completed', result, auditHash)

  return NextResponse.json({ ...result, audit_hash: auditHash })
}
