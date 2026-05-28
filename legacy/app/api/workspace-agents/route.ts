/**
 * Per-workspace agent configuration.
 * GET   — list every agent with engine / enabled / autonomy / config (defaults
 *         filled for roles that have no row yet).
 * PATCH — update one agent: { role, enabled?, autonomy?, config? }
 */
import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { requireWorkspacePlan } from '@/lib/api-plan-guard'
import { loadWorkspaceAgents, updateWorkspaceAgent } from '@/lib/agents/core/workspace-agents'
import { AGENT_ENGINE } from '@/lib/agents/core/engines'
import { SYSTEM_AGENTS } from '@/lib/agents/core/registry'
import { hasTeamFeatures } from '@/lib/plan-access'
import type { AgentRole } from '@/lib/agents/protocol/types'
import type { SubscriptionTier } from '@/lib/lead-credits'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('user_profiles').select('active_client_id, plan').eq('user_id', user.id).maybeSingle()
  const activeClientId = (profile?.active_client_id as string | null) ?? null
  let plan = ((profile?.plan as string | null) ?? 'free') as SubscriptionTier
  if (activeClientId) {
    const workspaceCheck = await requireWorkspacePlan(createAdminClient(), {
      userId: user.id,
      clientId: activeClientId,
      requiredTier: 'free',
    })
    if (workspaceCheck instanceof NextResponse) return workspaceCheck
    plan = workspaceCheck.tier
  }
  return { supabase, userId: user.id, workspaceId: activeClientId ?? user.id, plan }
}

const META = new Map(SYSTEM_AGENTS.map((a) => [a.role, { name: a.name, description: a.description, capabilities: (a.capabilities as Array<{ tool: string }>).map((c) => c.tool) }]))
const ENGINE_ORDER = { outbound: 0, content: 1, shared: 2 } as const

export async function GET() {
  const c = await ctx()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (c instanceof NextResponse) return c
  const map = await loadWorkspaceAgents(c.supabase, c.workspaceId)
  const agents = [...map.values()].map((a) => ({
    role: a.role,
    engine: a.engine,
    enabled: a.enabled,
    autonomy: a.autonomy,
    config: a.config,
    name: META.get(a.role)?.name ?? `${a.role}-agent`,
    description: META.get(a.role)?.description ?? '',
    capabilities: META.get(a.role)?.capabilities ?? [],
    health: a.health,
    lastRunAt: a.lastRunAt,
  })).sort((x, y) => (ENGINE_ORDER[x.engine] - ENGINE_ORDER[y.engine]) || x.role.localeCompare(y.role))
  return NextResponse.json({ agents })
}

export async function PATCH(request: Request) {
  const c = await ctx()
  if (!c) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (c instanceof NextResponse) return c
  const body = await request.json().catch(() => null) as { role?: string; enabled?: boolean; autonomy?: string; config?: Record<string, unknown> } | null
  const role = body?.role as AgentRole | undefined
  if (!role || !(role in AGENT_ENGINE)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  if (body?.autonomy && !['research_only', 'approve_first', 'autopilot'].includes(body.autonomy)) return NextResponse.json({ error: 'Invalid autonomy' }, { status: 400 })
  if (role === 'crm' && body?.enabled === true && !hasTeamFeatures(c.plan)) return NextResponse.json({ error: 'The CRM agent is available on the Team plan.' }, { status: 403 })
  await updateWorkspaceAgent(c.supabase, {
    workspaceId: c.workspaceId, userId: c.userId, role,
    patch: {
      ...(typeof body?.enabled === 'boolean' ? { enabled: body.enabled } : {}),
      ...(body?.autonomy ? { autonomy: body.autonomy as never } : {}),
      ...(body?.config ? { config: body.config } : {}),
    },
  })
  return NextResponse.json({ ok: true })
}
