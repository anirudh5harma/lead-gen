import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/agents/webhooks?agent_id=xxx
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agent_id')
  if (!agentId) return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })

  const { data } = await supabase
    .from('agent_webhook_subscriptions')
    .select('id, agent_id, url, event_types, min_score, icp_filter, is_active, last_delivered_at, last_error_at, created_at')
    .eq('agent_id', agentId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ webhooks: data ?? [] })
}

// POST /api/agents/webhooks
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    agent_id?: string
    url?: string
    event_types?: string[]
    min_score?: number
    icp_filter?: Record<string, unknown>
  } | null

  if (!body?.agent_id || !body?.url) {
    return NextResponse.json({ error: 'agent_id and url are required' }, { status: 400 })
  }

  // Verify ownership
  const { data: agent } = await supabase
    .from('agent_identities')
    .select('id')
    .eq('id', body.agent_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Check webhook limit by tier
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle()

  const plan = (profile?.plan as string) ?? 'free'
  const tierRow = await supabase
    .from('agent_rate_limit_tiers')
    .select('max_webhooks')
    .eq('tier', plan)
    .maybeSingle()

  const maxWebhooks = tierRow.data?.max_webhooks ?? 1

  const { count } = await supabase
    .from('agent_webhook_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', body.agent_id)

  if ((count ?? 0) >= maxWebhooks) {
    return NextResponse.json(
      { error: `Maximum of ${maxWebhooks} webhooks reached for this agent.` },
      { status: 403 },
    )
  }

  const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`

  const { data, error } = await supabase
    .from('agent_webhook_subscriptions')
    .insert({
      agent_id: body.agent_id,
      user_id: user.id,
      url: body.url,
      secret,
      event_types: body.event_types ?? ['signal.new'],
      min_score: body.min_score ?? 7,
      icp_filter: body.icp_filter ?? {},
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ webhook: data, secret }, { status: 201 })
}

// DELETE /api/agents/webhooks
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { webhook_id?: string } | null
  if (!body?.webhook_id) {
    return NextResponse.json({ error: 'webhook_id is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('agent_webhook_subscriptions')
    .delete()
    .eq('id', body.webhook_id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
