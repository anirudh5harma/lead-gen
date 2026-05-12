/**
 * A2A Workflow API — list and dispatch agent workflows.
 *
 * GET  /api/a2a/workflows  — List all available workflow definitions
 * POST /api/a2a/workflows  — Dispatch a workflow via the operator agent
 *
 * Body: { workflow: string, context?: Record<string, unknown> }
 * Auth: Bearer token (user session) or X-Agent-Key header.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureBootstrapped } from '@/lib/agents/core/registry'
import { dispatchTask } from '@/lib/agents/core/supervisor'
import { WORKFLOW_DEFINITIONS, type WorkflowName } from '@/lib/agents/core/workflow-types'
import type { AgentRole } from '@/lib/agents/protocol/types'
import { authenticateAgent } from '@/lib/a2a/agent-auth'

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
  return { type: 'user' as const, userId: user.id }
}

// ─── GET /api/a2a/workflows ──────────────────────────────────────────────

export async function GET(request: Request) {
  const auth = await authenticate(request)
  if (auth instanceof NextResponse) return auth
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  ensureBootstrapped()

  const workflows = Object.values(WORKFLOW_DEFINITIONS).map(def => ({
    name: def.name,
    displayName: def.displayName,
    description: def.description,
    steps: def.steps.map(s => ({
      order: s.order,
      role: s.role,
      tool: s.tool,
      description: s.description,
      required: s.required,
    })),
    estimatedCredits: def.estimatedCredits,
    estimatedLatencyMs: def.estimatedLatencyMs,
  }))

  return NextResponse.json({
    workflows,
    timestamp: new Date().toISOString(),
  })
}

// ─── POST /api/a2a/workflows ─────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = await authenticate(request)
  if (auth instanceof NextResponse) return auth
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { workflow?: string; context?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body?.workflow) {
    return NextResponse.json(
      { error: 'Workflow name is required', availableWorkflows: Object.keys(WORKFLOW_DEFINITIONS) },
      { status: 400 },
    )
  }

  const workflowName = body.workflow as WorkflowName
  const workflowDef = WORKFLOW_DEFINITIONS[workflowName]

  if (!workflowDef) {
    return NextResponse.json(
      {
        error: `Unknown workflow: "${workflowName}"`,
        availableWorkflows: Object.keys(WORKFLOW_DEFINITIONS),
      },
      { status: 404 },
    )
  }

  ensureBootstrapped()

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
      role: 'operator' as AgentRole,
      task: {
        tool: 'bombsell.operator.orchestrate',
        arguments: {
          workflow: workflowName,
          workflowDef: {
            name: workflowDef.name,
            displayName: workflowDef.displayName,
            steps: workflowDef.steps,
          },
          context: body.context ?? {},
        },
      },
      sessionId: crypto.randomUUID(),
    })

    return NextResponse.json({
      workflowName,
      result,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
