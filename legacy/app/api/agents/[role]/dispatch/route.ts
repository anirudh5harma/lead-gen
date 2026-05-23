/**
 * Per-agent direct tool dispatch endpoint.
 *
 * POST /api/agents/:role/dispatch  — Dispatch a single tool to a single agent.
 *
 * Body: { tool: string, arguments?: Record<string, unknown> }
 * Auth: Bearer token (user session) or X-Agent-Key header.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureBootstrapped, getAgentByRole } from '@/lib/agents/core/registry'
import { dispatchTask } from '@/lib/agents/core/supervisor'
import type { AgentRole } from '@/lib/agents/protocol/types'
import { authenticateAgent } from '@/lib/a2a/agent-auth'

const VALID_ROLES: AgentRole[] = [
  'signal', 'match', 'enrich', 'outreach', 'safety',
  'reply', 'booking', 'followup', 'insight', 'crm', 'operator',
]

// ─── Auth helpers ─────────────────────────────────────────────────────────

function agentKey(request: Request): string | null {
  return request.headers.get('x-agent-key') ?? null
}

async function authenticate(request: Request) {
  const key = agentKey(request)
  if (key === process.env.AGENT_API_SECRET) {
    return { type: 'agent' as const, userId: 'agent-system' }
  }
  if (request.headers.get('authorization')?.startsWith('Bearer bsk_agt_')) {
    const agent = await authenticateAgent(request)
    if (agent instanceof NextResponse) return agent
    return { type: 'agent' as const, userId: agent.userId, clientId: agent.clientId }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Fetch the active client_id for the user
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', user.id)
    .maybeSingle()

  return { type: 'user' as const, userId: user.id, clientId: profile?.active_client_id ?? null }
}

// ─── POST /api/agents/:role/dispatch ──────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ role: string }> },
) {
  const role = (await params).role as AgentRole

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json(
      { error: `Unknown agent role: "${role}"`, availableRoles: VALID_ROLES },
      { status: 404 },
    )
  }

  const auth = await authenticate(request)
  if (auth instanceof NextResponse) return auth
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Parse body
  let body: { tool?: string; arguments?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.tool) {
    return NextResponse.json({ error: 'Tool name is required in body.tool' }, { status: 400 })
  }

  ensureBootstrapped()

  const agent = getAgentByRole(role)
  if (!agent) {
    return NextResponse.json(
      { error: `Agent "${role}" not found in registry`, availableRoles: VALID_ROLES },
      { status: 404 },
    )
  }

  const supabase = await createClient()
  const userId = auth.type === 'user' ? auth.userId : 'agent-system'
  const clientId = auth.type === 'agent'
    ? auth.clientId ?? null
    : auth.type === 'user'
    ? (await supabase.from('user_profiles').select('active_client_id').eq('user_id', userId).maybeSingle()).data?.active_client_id ?? null
    : null

  try {
    const result = await dispatchTask(supabase, {
      userId,
      clientId,
      role,
      task: {
        tool: body.tool,
        arguments: body.arguments ?? {},
      },
      sessionId: crypto.randomUUID(),
    })

    return NextResponse.json({
      result,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
