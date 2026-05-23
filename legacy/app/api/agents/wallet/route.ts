import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

  const amount = typeof body?.amount === 'number' ? Math.round(body.amount) : 0
  if (!body?.agent_id || amount <= 0 || amount !== body.amount) {
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

  const { data: transfer, error: transferError } = await supabase.rpc('transfer_lead_credits_to_agent', {
    p_user_id: user.id,
    p_agent_id: body.agent_id,
    p_amount: amount,
  })

  if (transferError) {
    return NextResponse.json({ error: transferError.message }, { status: 500 })
  }

  const result = Array.isArray(transfer) ? transfer[0] : transfer
  if (!result?.success) {
    return NextResponse.json(
      { error: 'Insufficient human credits.', human_balance: result?.human_balance_after ?? null },
      { status: 402 },
    )
  }

  return NextResponse.json({
    ok: true,
    transferred: amount,
    agent_balance: result.agent_balance_after,
    human_balance_remaining: result.human_balance_after,
  })
}
