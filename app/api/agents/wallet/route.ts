import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { authenticateAgent } from '@/lib/a2a/agent-auth'

// GET /api/agents/wallet?agent_id=xxx - get agent wallet balance
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agent_id')
  if (!agentId) return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })

  // Verify ownership
  const { data: agent } = await supabase
    .from('agent_identities')
    .select('id')
    .eq('id', agentId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const { data: wallet } = await supabase
    .from('agent_wallets')
    .select('balance, auto_top_up, auto_top_up_threshold, auto_top_up_amount, total_consumed, total_earned')
    .eq('agent_id', agentId)
    .maybeSingle()

  const { data: transactions } = await supabase
    .from('agent_transactions')
    .select('id, tool, action, cost, status, created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({
    wallet: wallet ?? { balance: 0 },
    transactions: transactions ?? [],
  })
}

// POST /api/agents/wallet - top up agent credits from human wallet
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    agent_id?: string
    amount?: number
  } | null

  if (!body?.agent_id || !body?.amount || body.amount <= 0) {
    return NextResponse.json({ error: 'agent_id and positive amount are required' }, { status: 400 })
  }

  // Verify ownership
  const { data: agent } = await supabase
    .from('agent_identities')
    .select('id')
    .eq('id', body.agent_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Check human credit balance
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('lead_credit_balance')
    .eq('user_id', user.id)
    .maybeSingle()

  const humanBalance = profile?.lead_credit_balance ?? 0
  if (humanBalance < body.amount) {
    return NextResponse.json(
      { error: `Insufficient human credits. You have ${humanBalance} credits.` },
      { status: 402 },
    )
  }

  // Deduct from human, add to agent
  const { error: deductError } = await supabase.rpc('consume_lead_credit', {
    p_user_id: user.id,
    p_reason: 'agent_transfer',
    p_metadata: { agent_id: body.agent_id, amount: body.amount },
  })

  if (deductError) {
    return NextResponse.json({ error: deductError.message }, { status: 500 })
  }

  const { data: newBalance, error: grantError } = await supabase.rpc('grant_agent_credits', {
    p_agent_id: body.agent_id,
    p_amount: body.amount,
    p_source: 'human_transfer',
  })

  if (grantError) {
    return NextResponse.json({ error: grantError.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    transferred: body.amount,
    agent_balance: newBalance,
    human_balance_remaining: humanBalance - body.amount,
  })
}
