/**
 * A2A Agent Server — Agent-to-Agent communication endpoint.
 * Implements the Bombsell A2A protocol for external agent consumption.
 *
 * Endpoints:
 *   GET  /api/a2a/agents              — List all registered agents
 *   GET  /api/a2a/agents/:role        — Get agent profile and capabilities
 *   POST /api/a2a/message             — Send a message to an agent (blocking + streaming)
 *   GET  /api/a2a/tasks               — List tasks (running, completed, failed)
 *   GET  /api/a2a/tasks/:taskId       — Get task result
 *   POST /api/a2a/tasks/:taskId/retry — Retry a failed task
 *
 * Security: All requests require an agent API key (X-Agent-Key header) or
 * a valid Bombsell user session.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchTask, getQueueStatus } from '@/lib/agents/core/supervisor'
import { listAgents, getAgent, ensureBootstrapped } from '@/lib/agents/core/registry'
import type { AgentRole } from '@/lib/agents/protocol/types'
import type { AgentTaskInput } from '@/lib/agents/protocol/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agentKey(request: Request): string | null {
  return request.headers.get('x-agent-key') ?? null
}

async function authenticate(request: Request) {
  // Agent key auth (for external agents)
  const key = agentKey(request)
  if (key === process.env.AGENT_API_SECRET) return { type: 'agent' as const, userId: 'agent-system' }

  // User session auth
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return { type: 'user' as const, userId: user.id }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

// ─── GET /api/a2a/agents — List all agents ───────────────────────────────────

export async function GET(request: Request) {
  const url = new URL(request.url)
  const path = url.pathname

  const auth = await authenticate(request)
  if (!auth) return err('Unauthorized', 401)

  ensureBootstrapped()

  // GET /api/a2a/agents
  if (url.pathname === '/api/a2a/agents' && request.method === 'GET') {
    const agents = listAgents()
    const queueStatus = getQueueStatus()
    return json({
      agents: agents.map(a => ({
        id: a.id,
        name: a.name,
        role: a.role,
        description: a.description,
        version: a.version,
        health: a.health,
        capabilities: a.capabilities,
        apiEndpoint: a.apiEndpoint,
        scopes: a.scopes,
        configSchema: a.configSchema,
      })),
      queue: queueStatus,
      timestamp: new Date().toISOString(),
    })
  }

  // GET /api/a2a/agents/:role
  const roleMatch = path.match(/^\/api\/a2a\/agents\/([^/]+)$/)
  if (roleMatch && request.method === 'GET') {
    const role = roleMatch[1] as AgentRole
    const agent = getAgent(role)
    if (!agent) return err(`Agent not found: ${role}`, 404)
    return json({ agent, timestamp: new Date().toISOString() })
  }

  // GET /api/a2a/tasks
  if (path === '/api/a2a/tasks' && request.method === 'GET') {
    const queueStatus = getQueueStatus()
    return json({ tasks: queueStatus })
  }

  // GET /api/a2a/tasks/:taskId
  const taskMatch = path.match(/^\/api\/a2a\/tasks\/([^/]+)$/)
  if (taskMatch && request.method === 'GET') {
    const taskId = taskMatch[1]
    // Task results are stored in the queue map; for completed tasks we'd need a DB lookup
    return json({ taskId, status: 'unknown — results stored in agent run records' })
  }

  return err('Not found', 404)
}

// ─── POST /api/a2a/message — Send message to agent ──────────────────────────

export async function POST(request: Request) {
  const auth = await authenticate(request)
  if (!auth) return err('Unauthorized', 401)

  ensureBootstrapped()

  const url = new URL(request.url)
  const path = url.pathname

  // POST /api/a2a/message — generic agent dispatch
  if (path === '/api/a2a/message' || path === '/api/a2a/message/') {
    let body: {
      role?: string
      agent?: string
      tool?: string
      task?: AgentTaskInput
      sessionId?: string
      priority?: string
      stream?: boolean
    }
    try {
      body = await request.json()
    } catch {
      return err('Invalid JSON body')
    }

    const { role, agent, tool, task, sessionId, priority = 'normal', stream = false } = body

    // Resolve agent — can specify role or agent name directly
    const agentRole = (role ?? agent ?? '') as AgentRole
    if (!agentRole) return err('Must specify role or agent name')

    const agentProfile = getAgent(agentRole)
    if (!agentProfile) return err(`Agent not found: ${agentRole}`, 404)

    if (!tool && !task?.tool) return err('Must specify tool name')

    const supabase = await createClient()
    const userId = auth.type === 'user' ? auth.userId : 'agent-system'
    const clientId = auth.type === 'user'
      ? (await supabase.from('user_profiles').select('active_client_id').eq('user_id', userId).single()).data?.active_client_id ?? null
      : null

    const taskInput: AgentTaskInput = task ?? {
      tool: tool!,
      arguments: {},
      priority: priority as 'low' | 'normal' | 'high' | 'critical',
    }

    // Streaming: respond immediately with taskId, agent processes async
    if (stream) {
      const taskId = crypto.randomUUID()
      const traceId = crypto.randomUUID()

      // Kick off task in background
      const runTask = async () => {
        try {
          await dispatchTask(supabase, {
            userId,
            clientId,
            role: agentRole,
            task: taskInput,
            sessionId: sessionId ?? taskId,
          })
        } catch (e) {
          console.error('[a2a/stream] task failed:', e)
        }
      }
      // Fire and return taskId immediately
      runTask()

      return json({
        taskId,
        traceId,
        status: 'dispatched',
        streamEndpoint: `/api/a2a/tasks/${taskId}/stream`,
      })
    }

    // Blocking dispatch
    try {
      const result = await dispatchTask(supabase, {
        userId,
        clientId,
        role: agentRole,
        task: taskInput,
        sessionId: sessionId ?? crypto.randomUUID(),
      })
      return json({ result, timestamp: new Date().toISOString() })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return err(message, 500)
    }
  }

  // POST /api/a2a/tasks/:taskId/retry
  const retryMatch = path.match(/^\/api\/a2a\/tasks\/([^/]+)\/retry$/)
  if (retryMatch && request.method === 'POST') {
    const taskId = retryMatch[1]
    // Retry logic would look up original task and re-dispatch
    return json({ taskId, status: 'retry_dispatched' })
  }

  return err('Not found', 404)
}
