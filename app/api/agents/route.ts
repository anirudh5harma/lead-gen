import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureBootstrapped, listAgents } from '@/lib/agents/core/registry'

// GET /api/agents - list my agents (with health data from in-memory registry)
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  ensureBootstrapped()

  const { data: agents } = await supabase
    .from('agent_identities')
    .select('id, name, description, provider, principal_email, is_active, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  // Merge health data from the in-memory registry (matched by agent name)
  const registryAgents = listAgents()
  const healthByName = new Map(registryAgents.map(a => [a.name, a.health]))

  const enriched = (agents ?? []).map(agent => ({
    ...agent,
    health: healthByName.get(agent.name) ?? null,
  }))

  return NextResponse.json({ agents: enriched })
}

// POST /api/agents - register a new agent
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    name?: string
    description?: string
    provider?: string
    principal_email?: string
    metadata?: Record<string, unknown>
  } | null

  if (!body?.name) {
    return NextResponse.json({ error: 'Agent name is required' }, { status: 400 })
  }

  // Check agent limit by plan tier
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('plan')
    .eq('user_id', user.id)
    .maybeSingle()

  const plan = planToAgentRateLimitTier((profile?.plan as string) ?? 'free')
  const tierRow = await supabase
    .from('agent_rate_limit_tiers')
    .select('max_agents')
    .eq('tier', plan)
    .maybeSingle()

  const maxAgents = tierRow.data?.max_agents ?? 1

  const { count } = await supabase
    .from('agent_identities')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if ((count ?? 0) >= maxAgents) {
    return NextResponse.json(
      { error: `You have reached the maximum of ${maxAgents} agents for your ${plan} plan. Upgrade to create more.` },
      { status: 403 },
    )
  }

  const { data: agent, error } = await supabase
    .from('agent_identities')
    .insert({
      user_id: user.id,
      name: body.name,
      description: body.description ?? '',
      provider: body.provider ?? 'custom',
      principal_email: body.principal_email ?? user.email ?? '',
      metadata: body.metadata ?? {},
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ agent }, { status: 201 })
}

function planToAgentRateLimitTier(plan: string): string {
  if (plan === 'enterprise') return 'enterprise'
  if (plan === 'scale') return 'scale'
  if (plan === 'growth') return 'growth'
  return 'launch'
}
