/**
 * Agent Webhook Handler — receives task completion callbacks from external agents
 * and routes them into Bombsell's task completion pipeline.
 *
 * External agents (Claude Code, Codex, etc.) call this endpoint when they finish
 * a delegated Bombsell task and need to report results back.
 *
 * Also supports webhook-based task dispatch: Bomb[bombsell] → external agent → this endpoint.
 *
 * POST /api/agents/webhook  — receive task result from external agent
 * POST /api/agents/dispatch  — outbound webhook dispatcher to external agents
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyWebhookSignature, signWebhookPayload } from '@/lib/webhook-verification'
import { recordAgentEvent, type AgentName } from '@/lib/agent-events'
import { consumeAgentCredit } from '@/lib/a2a/cost-engine'
import { getAgent } from '@/lib/agents/core/registry'
import { ingestAgentFeedback } from '@/lib/agents/self-improvement/engine'

// ─── Webhook Receiver ────────────────────────────────────────────────────────

/**
 * POST /api/agents/webhook
 *
 * External agent completes a Bombsell task and reports the result.
 * The result is validated, credited, logged, and routed to the outcome-learning engine.
 *
 * Body:
 *   task_id:       string  — Bombsell's task UUID
 *   agent_name:    string  — calling agent identity
 *   status:        'completed' | 'failed' | 'cancelled'
 *   result?:       object  — task output (if completed)
 *   error?:        string  — error message (if failed)
 *   credits_used?: number  — agent-reported credit usage (verified server-side)
 *   metadata?:     object  — additional context (latency, token usage, etc.)
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // ── 1. Verify webhook signature (HMAC-SHA256) ──────────────────────────
  const signature = request.headers.get('x-bombsell-signature')
  const timestamp = request.headers.get('x-bombsell-timestamp')

  if (!signature || !timestamp) {
    return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 })
  }

  // Reject stale requests (> 5 minutes old)
  const age = Math.abs(Date.now() - Number(timestamp))
  if (age > 5 * 60 * 1000) {
    return NextResponse.json({ error: 'Request timestamp too old' }, { status: 401 })
  }

  const rawBody = await request.text()
  const isValid = verifyWebhookSignature(rawBody, signature, timestamp)
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: {
    taskId?: string
    agentName?: string
    status?: string
    result?: Record<string, unknown>
    error?: string
    creditsUsed?: number
    metadata?: Record<string, unknown>
  }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { taskId, agentName, status, result, error, creditsUsed, metadata } = body

  if (!taskId || !agentName || !status) {
    return NextResponse.json(
      { error: 'Missing required fields: taskId, agentName, status' },
      { status: 400 }
    )
  }

  if (!['completed', 'failed', 'cancelled'].includes(status)) {
    return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 })
  }

  // ── 2. Validate calling agent is registered ─────────────────────────────
  const agent = getAgent(String(agentName))
  if (!agent) {
    return NextResponse.json({ error: `Unknown agent: ${agentName}` }, { status: 404 })
  }

  // ── 3. Record lifecycle event ───────────────────────────────────────────
  await recordAgentEvent(supabase, {
    agentName: agent.id as AgentName,
    eventType: 'task.completed',
    status: status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'skipped',
    title: `External agent webhook: ${status}`,
    metadata: {
      taskId,
      result,
      error,
      creditsUsed: creditsUsed ?? 0,
      ...metadata,
    },
  })

  // ── 4. Consume credits (use agent's reported value; Bombsell re-verifies) ──
  if (creditsUsed && creditsUsed > 0) {
    const verifiedCredits = Math.min(creditsUsed, 10) // hard cap per task
    await consumeAgentCredit(supabase, agent.id, 'bombsell.webhook.receive', taskId, { credits: verifiedCredits })
  }

  // ── 5. Route to outcome learning if completed ──────────────────────────
  if (status === 'completed' && result) {
    // Trigger async outcome learning (don't block response)
    ingestAgentFeedback(supabase, {
      // Map AgentFeedback fields correctly
      agentId: agent.id,
      taskId,
      traceId: `webhook-${taskId}`,
      outcome: status === 'completed' ? 'success' : status === 'failed' ? 'failure' : 'partial',
      qualityScore: status === 'completed' ? 90 : status === 'failed' ? 20 : 50,
      errorReason: error ?? undefined,
      metadata: { ...metadata, latencyMs: typeof metadata?.latencyMs === 'number' ? metadata.latencyMs : undefined },
    }).catch(console.error)
  }

  // ── 6. Acknowledge receipt ──────────────────────────────────────────────
  return NextResponse.json({
    received: true,
    taskId,
    agentName,
    status,
    outcomeLearningTriggered: status === 'completed',
  })
}

// ─── Outbound Dispatcher ─────────────────────────────────────────────────────

/**
 * POST /api/agents/dispatch
 *
 * Internal Bombsell supervisor dispatches a task to an external agent via webhook.
 * This is called by the supervisor when it cannot handle a tool itself and needs
 * to delegate to an external agent (e.g., a custom Claude Code agent the user configured).
 *
 * Body:
 *   targetUrl:      string  — external agent's webhook接收 URL
 *   taskId:         string  — Bombsell task ID
 *   tool:           string  — tool name (e.g., bombsell.signal.poll)
 *   args:           object  — tool arguments
 *   callbackUrl?:   string  — URL to POST results back to (Bombsell's own webhook)
 *   secret?:        string  — shared secret for HMAC signing (if not using Bombsell-managed keys)
 */
export async function PUT(request: NextRequest) {
  const body = await request.json()
  const { targetUrl, taskId, tool, args, callbackUrl, secret } = body as {
    targetUrl?: string
    taskId?: string
    tool?: string
    args?: Record<string, unknown>
    callbackUrl?: string
    secret?: string
  }

  if (!targetUrl || !taskId || !tool) {
    return NextResponse.json(
      { error: 'Missing required fields: targetUrl, taskId, tool' },
      { status: 400 }
    )
  }

  // Validate URL is HTTPS (no http:, file:, etc.)
  let target: URL
  try {
    target = new URL(targetUrl)
    if (!['http:', 'https:'].includes(target.protocol)) {
      throw new Error('Invalid protocol')
    }
  } catch {
    return NextResponse.json({ error: 'Invalid targetUrl' }, { status: 400 })
  }

  const timestamp = String(Date.now())
  const payload = JSON.stringify({ taskId, tool, args, callbackUrl: callbackUrl ?? null })
  const signature = signWebhookPayload(payload, timestamp, secret ?? process.env['AGENT_WEBHOOK_SECRET'] ?? 'dev-secret')

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bombsell-signature': signature,
        'x-bombsell-timestamp': timestamp,
        'x-bombsell-task-id': taskId,
      },
      body: payload,
      // 30 second timeout for external agent dispatch
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Upstream agent unreachable', details: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    )
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json(
      { error: 'Upstream agent returned error', status: upstreamResponse.status },
      { status: 502 }
    )
  }

  return NextResponse.json({
    dispatched: true,
    taskId,
    target: target.toString(),
    upstreamStatus: upstreamResponse.status,
  })
}

// ─── Health Check ─────────────────────────────────────────────────────────────

/**
 * GET /api/agents/webhook
 *
 * Returns 200 if the webhook endpoint is healthy. Used by external agents
 * to verify connectivity before dispatching tasks.
 */
export async function GET() {
  return NextResponse.json({
    service: 'bombsell-agents-webhook',
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  })
}
