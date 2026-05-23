import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { authenticateAgent, scopeGuard } from '@/lib/a2a/agent-auth'
import { checkAgentRateLimit } from '@/lib/a2a/rate-limit'
import { consumeAgentCredit, getCostEstimate, finalizeTransaction } from '@/lib/a2a/cost-engine'

// GET /api/v1/signals - list signals for the agent's ICP
export async function GET(request: Request) {
  const agent = await authenticateAgent(request)
  if (agent instanceof NextResponse) return agent

  const scopeCheck = scopeGuard(agent, 'read:signals')
  if (scopeCheck) return scopeCheck

  const supabase = createAdminClient()

  const rateLimit = await checkAgentRateLimit(supabase, agent.apiKeyId, agent.rateLimitTier)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', reset_at: rateLimit.resetAt, window: rateLimit.window },
      { status: 429 },
    )
  }

  const { searchParams } = new URL(request.url)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 20)))
  const minScore = Number(searchParams.get('min_score') ?? 7)

  // Get cost estimate
  const cost = await getCostEstimate(supabase, 'signal_delivered')

  // Consume credit
  const tx = await consumeAgentCredit(supabase, agent.agentId, 'signal_delivered', 'bombsell.list_signals')
  if (!tx.success) {
    return NextResponse.json(
      { error: tx.error ?? 'Insufficient credits', balance: tx.balanceAfter },
      { status: 402 },
    )
  }

  // Fetch signals
  let query = supabase
    .from('leads')
    .select('id, target_company, company_domain, relevance_score, relevance_reason, status, created_at, sent_at, replied_at, contact_email, contact_name, contact_title')
    .eq('user_id', agent.userId)
    .gte('relevance_score', minScore)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (agent.clientId) query = query.eq('client_id', agent.clientId)

  const { data: signals, error } = await query

  if (error) {
    await finalizeTransaction(supabase, tx.transactionId!, 'failed', { error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const responsePayload = {
    signals: signals ?? [],
    count: signals?.length ?? 0,
    cost_basis: cost ? { action: cost.action, credits: cost.creditCost, unit: cost.unit } : null,
    balance_after: tx.balanceAfter,
    transaction_id: tx.transactionId,
  }

  await finalizeTransaction(supabase, tx.transactionId!, 'completed', responsePayload)

  return NextResponse.json(responsePayload)
}
