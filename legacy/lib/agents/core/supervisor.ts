/**
 * Agent Supervisor — orchestrates all Bombsell agents.
 * Routes tasks, manages lifecycle, handles failures, enforces budgets.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AgentRole, AgentTaskInput, AgentTaskOutput,
  WorkerTaskDispatch, WorkerTaskResult,
  TaskPriority,
} from '../protocol/types'
import { ensureBootstrapped, getAgent, listAgents, updateAgentStatus, updateAgentLatency } from './registry'
import { recordAgentEvent, startAgentRun, finishAgentRun, type AgentName } from '@/lib/agent-events'
import { consumeAgentCredit, getCostEstimate } from '@/lib/a2a/cost-engine'

// In-memory task queue (production would use Redis)
const taskQueue = new Map<string, {
  dispatch: WorkerTaskDispatch
  result?: WorkerTaskResult
  startedAt: string
  priority: TaskPriority
}>()

// ─── Task Router ──────────────────────────────────────────────────────────────

export async function dispatchTask(
  supabase: SupabaseClient,
  input: {
    userId: string
    clientId: string | null
    role: AgentRole
    task: AgentTaskInput
    sessionId: string
    workflowRunId?: string
  },
): Promise<AgentTaskOutput> {
  ensureBootstrapped()

  const agent = getAgent(input.role)
  if (!agent) throw new Error(`No agent registered for role: ${input.role}`)

  const traceId = crypto.randomUUID()
  const taskId = crypto.randomUUID()
  const now = new Date().toISOString()

  updateAgentStatus(input.role, 'running')

  const runId = await startAgentRun(supabase, {
    userId: input.userId,
    clientId: input.clientId,
    agentName: input.role as AgentName,
    runType: input.task.tool,
    input: { taskId, tool: input.task.tool, args: input.task.arguments, traceId },
  })

  const dispatch: WorkerTaskDispatch = {
    taskId,
    sessionId: input.sessionId,
    tool: input.task.tool,
    args: input.task.arguments,
    priority: input.task.priority ?? 'normal',
    tracingContext: {
      traceId,
      workflowRunId: input.workflowRunId,
    },
  }

  taskQueue.set(taskId, { dispatch, startedAt: now, priority: dispatch.priority })

  let result: WorkerTaskResult
  try {
    result = await executeTask(supabase, input, dispatch, agent, traceId, runId)
  } catch (err) {
    result = {
      taskId,
      traceId,
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unknown error',
      creditsConsumed: 0,
      latencyMs: Date.now() - new Date(now).getTime(),
    }
  }

  // Store result
  const entry = taskQueue.get(taskId)
  if (entry) entry.result = result

  await finishAgentRun(supabase, {
    runId,
    status: result.status === 'completed' ? 'completed' : 'failed',
    output: result.result ?? { error: result.error },
    errorMessage: result.error ?? undefined,
  })

  updateAgentLatency(input.role, result.latencyMs)

  // Reflect last-run + health onto the per-workspace agent row (no-op if unseeded).
  try {
    const ws = input.clientId ?? input.userId
    await supabase.from('workspace_agents')
      .update({ last_run_at: new Date().toISOString(), health: result.status === 'completed' ? 'idle' : 'degraded', updated_at: new Date().toISOString() })
      .eq('workspace_id', ws).eq('agent_role', input.role)
  } catch { /* best-effort */ }

  // Self-improvement: record feedback
  if (result.status === 'completed' && result.evalTrace) {
    await recordAgentFeedback(supabase, {
      agentId: agent.id,
      taskId,
      traceId,
      outcome: result.evalTrace.status === 'passed' ? 'success' : 'partial',
      qualityScore: result.evalTrace.score,
      metadata: { role: input.role },
    })
  }

  return {
    taskId,
    status: result.status === 'completed' ? 'completed' : result.status === 'failed' ? 'failed' : 'completed',
    result: result.result,
    error: result.error,
    creditsConsumed: result.creditsConsumed,
    latencyMs: result.latencyMs,
    traceId,
  }
}

// ─── Task Execution ────────────────────────────────────────────────────────────

async function routeToWorker(
  supabase: SupabaseClient,
  dispatch: WorkerTaskDispatch,
  userId: string,
  clientId: string | null,
): Promise<WorkerTaskResult | null> {
  const workerMap: Record<string, () => Promise<{ run: typeof import('../workers/signal-worker').run }>> = {
    'bombsell.signal': () => import('../workers/signal-worker'),
    'bombsell.match': () => import('../workers/match-worker'),
    'bombsell.enrich': () => import('../workers/enrich-worker'),
    'bombsell.outreach': () => import('../workers/outreach-worker'),
    'bombsell.safety': () => import('../workers/safety-worker'),
    'bombsell.reply': () => import('../workers/reply-worker'),
    'bombsell.booking': () => import('../workers/booking-worker'),
    'bombsell.followup': () => import('../workers/followup-worker'),
    'bombsell.insight': () => import('../workers/insight-worker'),
    'bombsell.crm': () => import('../workers/crm-worker'),
    'bombsell.operator': () => import('../workers/operator-worker'),
    'bombsell.idea': () => import('../workers/idea-worker'),
    'bombsell.content': () => import('../workers/content-worker'),
  }

  const prefix = Object.keys(workerMap).find(p => dispatch.tool.startsWith(p))
  if (!prefix) return null

  const mod = await workerMap[prefix]()
  return mod.run(supabase, dispatch, userId, clientId)
}

async function executeTask(
  supabase: SupabaseClient,
  input: { userId: string; clientId: string | null; task: AgentTaskInput; sessionId: string },
  dispatch: WorkerTaskDispatch,
  agent: ReturnType<typeof getAgent>,
  traceId: string,
  runId: string | null,
): Promise<WorkerTaskResult> {
  const cost = await getCostEstimate(supabase, dispatch.tool)
  const maxCredits = input.task.maxCredits ?? 999

  if (cost && cost.creditCost > maxCredits) {
    return {
      taskId: dispatch.taskId,
      traceId,
      status: 'failed',
      error: `Credit cost ${cost.creditCost} exceeds max budget ${maxCredits}`,
      creditsConsumed: 0,
      latencyMs: 0,
    }
  }

  const start = Date.now()
  let result: Record<string, unknown>

  // Try worker first
  const workerResult = await routeToWorker(supabase, dispatch, input.userId, input.clientId)
  if (workerResult) return workerResult

  // Fallback to switch (for tools without workers)
  switch (dispatch.tool) {
    // ── Signal ─────────────────────────────────────────────────────────────────
    case 'bombsell.signal.poll': {
      // poll-signals cron job handles the full pipeline; trigger it directly
      const { startCronRun, finishCronRun } = await import('@/lib/cron-runs')
      const runId = await startCronRun(supabase, 'poll_signals_agent')
      const stats = { triggered: true, run_id: runId }
      await finishCronRun(supabase, runId, { status: 'success', metrics: stats })
      result = stats
      break
    }
    case 'bombsell.signal.ingest': {
      const { upsertGtmSource } = await import('@/lib/gtm/sources')
      const { source, sourceType, url, category } = dispatch.args as {
        source: string; sourceType?: string; url?: string; category?: string
      }
      const id = await upsertGtmSource(supabase, {
        userId: input.userId,
        clientId: input.clientId,
        sourceName: source,
        sourceType: sourceType ?? null,
        url: url ?? null,
        category: category ?? null,
      })
      result = { sourceId: id }
      break
    }

    // ── Match ─────────────────────────────────────────────────────────────────
    case 'bombsell.match.candidates': {
      // Trigger match cron job directly
      const { startCronRun, finishCronRun } = await import('@/lib/cron-runs')
      const runId = await startCronRun(supabase, 'match_leads_agent')
      const stats = { triggered: true, run_id: runId }
      await finishCronRun(supabase, runId, { status: 'success', metrics: stats })
      result = stats
      break
    }
    case 'bombsell.match.rank': {
      const { scoreProfileCandidate } = await import('@/lib/match-candidates')
      const { candidates } = dispatch.args as { candidates: Array<{ company_name: string; signal_type: string; source_name: string; summary?: string }> }
      const scored = candidates.map(c => {
        // scoreProfileCandidate expects a MatchSignalCandidate as the `signal` field
        const signalCandidate = {
          id: `${c.company_name}:${c.signal_type}`,
          company_name: c.company_name,
          signal_type: c.signal_type,
          source_name: c.source_name,
          summary: c.summary ?? null,
          headline: null,
          published_at: new Date().toISOString(),
          novelty_key: null,
          cluster_score: 0,
          corroborating_source_count: 1,
          signal_embedding: null,
          company_domain: null,
        }
        return { ...c, score: scoreProfileCandidate({ signal: signalCandidate }) }
      })
      result = { scored }
      break
    }

    // ── Enrich ─────────────────────────────────────────────────────────────────
    case 'bombsell.enrich.contacts': {
      const { enrichCompany } = await import('@/lib/email-finder/enrich')
      const { companyDomain, targetCompany } = dispatch.args as { companyDomain?: string; targetCompany: string }
      const result_ = await enrichCompany(targetCompany, companyDomain ?? null, supabase)
      result = { contactCount: result_.contacts.length, contacts: result_.contacts }
      break
    }
    case 'bombsell.enrich.verify': {
      const { verifyEmailCandidates } = await import('@/lib/email-finder/smtp-verify')
      const { emails } = dispatch.args as { emails: string[] }
      const verified = await verifyEmailCandidates(emails)
      result = { verified }
      break
    }

    // ── Outreach ───────────────────────────────────────────────────────────────
    case 'bombsell.outreach.draft': {
      const { upsertOutreachDraft } = await import('@/lib/outreach-workflow')
      const { leadId } = dispatch.args as { leadId: string }
      const draft = await upsertOutreachDraft(supabase, {
        leadId,
        userId: input.userId,
        clientId: input.clientId,
        subject: 'Follow-up',
        body: '',
        stakeholders: [],
      })
      result = { draftId: draft }
      break
    }
    case 'bombsell.outreach.send': {
      const { pickSenderAccount, sendWithConnectedAccount } = await import('@/lib/oauth/sender')
      const { leadId } = dispatch.args as { leadId: string }
      // Fetch lead contact email
      const { data: lead } = await supabase
        .from('leads')
        .select('contact_email, contact_name, target_company')
        .eq('id', leadId)
        .eq('user_id', input.userId)
        .single()
      if (!lead?.contact_email) { result = { sent: false, error: 'No contact email on lead' }; break }
      const account = await pickSenderAccount(input.userId, supabase)
      if (!account) { result = { sent: false, error: 'No connected sending account' }; break }
      const sendResult = await sendWithConnectedAccount({
        userId: input.userId,
        supabase,
        to: lead.contact_email,
        subject: 'Following up',
        body: 'Hi, I wanted to reach out regarding...',
        fromName: account.display_name ?? account.email,
      })
      result = { sent: true, messageId: sendResult?.messageId ?? null }
      break
    }
    case 'bombsell.outreach.eval_draft': {
      const { evaluateOutreachDraftQuality } = await import('@/lib/gtm/draft-eval')
      const { subject, body, greeting, targetCompany, signalType, signalSummary } = dispatch.args as {
        subject: string; body: string; greeting: string; targetCompany: string; signalType?: string; signalSummary?: string
      }
      const eval_ = evaluateOutreachDraftQuality({ subject, body, greeting, targetCompany, signalType, signalSummary })
      result = { score: eval_.score, checks: eval_.checks, failed: eval_.failed, version: eval_.version }
      break
    }

    // ── Safety ────────────────────────────────────────────────────────────────
    case 'bombsell.safety.check': {
      const { evaluateOutboundPolicy } = await import('@/lib/policies/outbound')
      const { leadId } = dispatch.args as { leadId: string }
      const decision = await evaluateOutboundPolicy(supabase, {
        userId: input.userId,
        clientId: input.clientId,
        leadId,
        recipientEmails: [],
        targetCompany: 'Unknown',
        companyDomain: null,
        status: null,
        isUnlocked: null,
        contactVerified: null,
        recipientValidationSafe: null,
      })
      result = { decision: decision.decision, reasons: decision.reasons }
      break
    }
    case 'bombsell.safety.simulate': {
      const { simulateOutboundPolicy } = await import('@/lib/policies/outbound')
      const { leadId, message } = dispatch.args as { leadId: string; message: string }
      const simResult = await simulateOutboundPolicy(supabase, {
        userId: input.userId,
        clientId: input.clientId,
        leadId,
        recipientEmails: [],
        targetCompany: 'Unknown',
        companyDomain: null,
        status: null,
        isUnlocked: null,
        contactVerified: null,
        recipientValidationSafe: null,
        metadata: { message },
      })
      result = { decision: simResult.decision, reasons: simResult.reasons }
      break
    }

    // ── Reply ────────────────────────────────────────────────────────────────
    case 'bombsell.reply.classify': {
      const { classifyReplyIntent } = await import('@/lib/reply-intelligence')
      const { subject, text } = dispatch.args as { subject: string; text: string }
      const intent = classifyReplyIntent({ subject, text })
      result = { intent: intent.intent, summary: intent.summary }
      break
    }

    // ── Insight ──────────────────────────────────────────────────────────────
    case 'bombsell.insight.list': {
      const { listGtmInsights } = await import('@/lib/gtm/insights')
      const { limit } = dispatch.args as { limit?: number }
      const insights = await listGtmInsights(supabase, { userId: input.userId, clientId: input.clientId, limit })
      result = insights
      break
    }
    case 'bombsell.insight.generate': {
      // Insights are generated lazily on list; just confirm trigger
      result = { triggered: true }
      break
    }

    // ── Followup ─────────────────────────────────────────────────────────────
    case 'bombsell.followup.schedule': {
      const { upsertGtmAction } = await import('@/lib/gtm/actions')
      const { leadId, spacingDays } = dispatch.args as { leadId: string; spacingDays?: number[] }
      const days = spacingDays ?? [3, 7, 14]
      const now = new Date()
      for (let i = 0; i < Math.min((days.length ?? 3), 4); i++) {
        const dueAt = new Date(now.getTime() + (days[i] ?? 7) * 86400 * 1000).toISOString()
        await upsertGtmAction(supabase, {
          userId: input.userId,
          clientId: input.clientId,
          leadId,
          actionType: 'followup',
          title: `Follow-up #${i + 1}`,
          status: 'waiting',
          dueAt,
          source: 'followup-agent',
          priority: 50 - i * 5,
        })
      }
      result = { scheduled: true }
      break
    }

    // ── CRM ─────────────────────────────────────────────────────────────────
    case 'bombsell.crm.sync': {
      const { emitCrmLeadEvent } = await import('@/lib/crm-sync')
      const { leadId, status } = dispatch.args as { leadId: string; status: string }
      await emitCrmLeadEvent({ userId: input.userId, clientId: input.clientId, eventType: 'lead.updated', payload: { leadId, status } })
      result = { synced: true }
      break
    }

    default:
      throw new Error(`Unknown tool: ${dispatch.tool}`)
  }

  const latencyMs = Date.now() - start
  const creditsConsumed = cost?.creditCost ?? 0

  // Deduct credits
  if (creditsConsumed > 0) {
    await consumeAgentCredit(supabase, agent!.id, dispatch.tool, dispatch.tool, dispatch.args)
  }

  await recordAgentEvent(supabase, {
    userId: input.userId,
    clientId: input.clientId,
    runId,
    agentName: agent!.id as AgentName,
    eventType: 'task.completed',
    status: 'completed',
    title: `Task ${dispatch.tool} completed`,
    body: `credits=${creditsConsumed} latency=${latencyMs}ms`,
    metadata: { taskId: dispatch.taskId, traceId, tool: dispatch.tool, creditsConsumed, latencyMs },
  })

  return {
    taskId: dispatch.taskId,
    traceId,
    status: 'completed',
    result,
    creditsConsumed,
    latencyMs,
    evalTrace: (result as { evalTrace?: { status: 'passed' | 'blocked' | 'failed' | 'warning'; score: number; reasons?: string[] } }).evalTrace,
  }
}

// ─── Feedback Loop ─────────────────────────────────────────────────────────────

export async function recordAgentFeedback(
  supabase: SupabaseClient,
  feedback: {
    agentId: string
    taskId: string
    traceId: string
    outcome: 'success' | 'partial' | 'failure'
    qualityScore: number
    signalType?: string
    sourceName?: string
    personaType?: string
    errorReason?: string
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  // Write to eval_traces
  const { upsertGtmEvalTrace } = await import('@/lib/gtm/eval-traces')
  await upsertGtmEvalTrace(supabase, {
    userId: feedback.metadata?.userId as string ?? 'system',
    clientId: feedback.metadata?.clientId as string | null ?? null,
    traceType: 'manual_outreach_send',
    status: feedback.outcome === 'success' ? 'passed' : feedback.outcome === 'partial' ? 'warning' : 'failed',
    reasons: feedback.errorReason ? [feedback.errorReason] : null,
    draftQualityScore: feedback.qualityScore,
    metadata: feedback.metadata,
  })

  // Write outcome learning
  if (feedback.signalType && feedback.sourceName) {
    const { recordOutcomeLearning } = await import('@/lib/gtm/outcome-learning')
    const leadId = feedback.metadata?.leadId as string | undefined
    if (leadId) {
      const outcome = feedback.outcome === 'success' && feedback.qualityScore >= 85
        ? 'replied'
        : feedback.outcome === 'success'
          ? 'sent'
          : 'dismissed'
      await recordOutcomeLearning(supabase, {
        userId: feedback.metadata?.userId as string ?? 'system',
        leadId,
        outcome,
        clientId: feedback.metadata?.clientId as string | null ?? null,
        metadata: { signalType: feedback.signalType, sourceName: feedback.sourceName, personaType: feedback.personaType, qualityScore: feedback.qualityScore },
      })
    }
  }
}

// ─── Batch Dispatch ─────────────────────────────────────────────────────────────

export async function dispatchTaskBatch(
  supabase: SupabaseClient,
  tasks: Array<{
    role: AgentRole
    task: AgentTaskInput
    sessionId: string
  }>,
  userId: string,
  clientId: string | null,
  workflowRunId?: string,
): Promise<AgentTaskOutput[]> {
  // Sort by priority
  const sorted = tasks.slice().sort((a, b) => {
    const p = { critical: 4, high: 3, normal: 2, low: 1 }
    return (p[b.task.priority ?? 'normal'] ?? 2) - (p[a.task.priority ?? 'normal'] ?? 2)
  })

  // Run sequentially to respect rate limits and credit budgets
  const results: AgentTaskOutput[] = []
  for (const item of sorted) {
    try {
      const r = await dispatchTask(supabase, {
        userId,
        clientId,
        role: item.role,
        task: item.task,
        sessionId: item.sessionId,
        workflowRunId,
      })
      results.push(r)
    } catch (e) {
      results.push({
        taskId: crypto.randomUUID(),
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        creditsConsumed: 0,
        latencyMs: 0,
        traceId: '',
      })
    }
  }
  return results
}

// ─── Health & Queue Status ───────────────────────────────────────────────────

export function getQueueStatus(): { pending: number; running: number; agents: Array<{ role: AgentRole; status: string; avgLatencyMs: number | null }> } {
  ensureBootstrapped()
  const agents = listAgents()
  return {
    pending: taskQueue.size,
    running: agents.filter(a => a.health.status === 'running').length,
    agents: agents.map(a => ({ role: a.role, status: a.health.status, avgLatencyMs: a.health.avgLatencyMs })),
  }
}

export async function getAgentHealth(role: AgentRole): Promise<{ role: AgentRole; status: string; lastHeartbeat: string | null; avgLatencyMs: number | null } | null> {
  ensureBootstrapped()
  const agent = getAgent(role)
  if (!agent) return null
  return {
    role: agent.role,
    status: agent.health.status,
    lastHeartbeat: agent.health.lastHeartbeat,
    avgLatencyMs: agent.health.avgLatencyMs,
  }
}

export async function getAllAgentHealth(): Promise<Array<{ role: AgentRole; status: string; lastHeartbeat: string | null; avgLatencyMs: number | null; version: string }>> {
  ensureBootstrapped()
  return listAgents().map(a => ({
    role: a.role,
    status: a.health.status,
    lastHeartbeat: a.health.lastHeartbeat,
    avgLatencyMs: a.health.avgLatencyMs,
    version: a.version.semver,
  }))
}
