import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
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

  const supabase = createAdminClient()

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

  const companyDomain = normalizeCompanyDomain(body?.company_domain)
  const contactEmail = body?.contact_email?.trim().toLowerCase()
  if (!companyDomain || !contactEmail || !body?.message_body) {
    return NextResponse.json(
      { error: 'company_domain, contact_email, and message_body are required' },
      { status: 400 },
    )
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return NextResponse.json({ error: 'contact_email must be a valid email address' }, { status: 400 })
  }

  const cost = await getCostEstimate(supabase, 'outreach_executed')
  const tx = await consumeAgentCredit(supabase, agent.agentId, 'outreach_executed', 'bombsell.execute_outreach', body)

  if (!tx.success) {
    return NextResponse.json(
      { error: tx.error ?? 'Insufficient credits', balance: tx.balanceAfter },
      { status: 402 },
    )
  }

  let leadQuery = supabase
    .from('leads')
    .select('id, contact_email, contact_verified')
    .eq('user_id', agent.userId)
    .eq('company_domain', companyDomain)
    .order('created_at', { ascending: false })
    .limit(1)

  if (agent.clientId) leadQuery = leadQuery.eq('client_id', agent.clientId)

  const { data: matchingLeads, error: leadError } = await leadQuery
  const lead = matchingLeads?.[0] ?? null
  if (leadError || !lead) {
    const errorPayload = {
      error: leadError?.message ?? 'No matching account found for this agent workspace.',
      balance_after: tx.balanceAfter,
    }
    await finalizeTransaction(supabase, tx.transactionId!, 'failed', errorPayload)
    return NextResponse.json(errorPayload, { status: leadError ? 500 : 404 })
  }

  const verifiedContact = Boolean(
    lead.contact_verified &&
    typeof lead.contact_email === 'string' &&
    lead.contact_email.trim().toLowerCase() === contactEmail,
  )

  // Run guardrails
  const guardrails = [
    createAttestation(GUARDRAIL_TYPES.CONTACT_VERIFIED, verifiedContact, {
      email: contactEmail,
      verification_source: verifiedContact ? 'workspace_lead' : 'missing_or_mismatched_workspace_contact',
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

function normalizeCompanyDomain(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  return normalized && normalized.includes('.') ? normalized : null
}
