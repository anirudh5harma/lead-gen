/**
 * Self-Improvement Engine — closes the feedback loop from outcomes back to agent behaviour.
 *
 * Flow: eval-trace → outcome-learning → memory → ranking-feedback → agent config patch
 *
 * This runs continuously:
 *   1. Outcome learning records what worked (replied/booked) vs what didn't
 *   2. Memory aggregates patterns across signal-type, source, persona, company
 *   3. Ranking feedback updates match-agent's adaptive scoring
 *   4. Tuning hints are surfaced to agent config for next dispatch
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentFeedback, AgentTuningHint, AgentRole } from '../protocol/types'
import { recordGtmMemory } from '@/lib/gtm/memory'
import { upsertGtmEvalTrace, classifyFailureTaxonomy } from '@/lib/gtm/eval-traces'
import { recordOutcomeLearning } from '@/lib/gtm/outcome-learning'
import { getAgent, updateAgentHealth } from '../core/registry'

// ─── Feedback Ingestion ───────────────────────────────────────────────────────

export async function ingestAgentFeedback(
  supabase: SupabaseClient,
  feedback: AgentFeedback,
): Promise<AgentTuningHint | null> {
  const agent = getAgent(feedback.agentId)
  if (!agent) return null

  // 1. Write eval trace
  const traceStatus = feedback.outcome === 'success' && feedback.qualityScore >= 85
    ? 'passed'
    : feedback.outcome === 'partial'
      ? 'warning'
      : 'failed'

  await upsertGtmEvalTrace(supabase, {
    userId: feedback.metadata?.userId as string ?? 'system',
    clientId: feedback.metadata?.clientId as string | null ?? null,
    leadId: feedback.metadata?.leadId as string | undefined,
    workflowRunId: feedback.metadata?.workflowRunId as string | undefined,
    traceType: feedback.metadata?.traceType as 'manual_outreach_send' | 'automation_send' | 'followup_send' | 'policy_simulation' | 'draft_quality' ?? 'manual_outreach_send',
    status: traceStatus,
    reasons: feedback.errorReason ? [feedback.errorReason] : null,
    draftQualityScore: feedback.qualityScore,
    metadata: feedback.metadata,
  })

  // 2. Write outcome learning
  if (feedback.metadata?.leadId) {
    const outcome = feedback.outcome === 'success'
      ? (feedback.qualityScore >= 90 ? 'booked' : 'replied')
      : feedback.outcome === 'partial'
        ? 'sent'
        : 'dismissed'

    await recordOutcomeLearning(supabase, {
      userId: feedback.metadata?.userId as string ?? 'system',
      leadId: feedback.metadata.leadId as string,
      outcome,
      clientId: feedback.metadata?.clientId as string | null ?? null,
      agentRunId: feedback.metadata?.agentRunId as string | undefined,
      workflowRunId: feedback.metadata?.workflowRunId as string | undefined,
      metadata: {
        signalType: feedback.signalType,
        sourceName: feedback.sourceName,
        personaType: feedback.personaType,
        qualityScore: feedback.qualityScore,
      },
    })
  }

  // 3. Write pattern memory
  await recordPatternMemory(supabase, feedback, agent.role)

  // 4. Derive tuning hint
  return deriveTuningHint(supabase, feedback, agent.role)
}

// ─── Pattern Memory ────────────────────────────────────────────────────────────

async function recordPatternMemory(
  supabase: SupabaseClient,
  feedback: AgentFeedback,
  role: AgentRole,
): Promise<void> {
  const quality = feedback.qualityScore
  const signalType = feedback.signalType ?? 'unknown'
  const sourceName = feedback.sourceName ?? 'unknown'
  const personaType = feedback.personaType ?? 'unknown'

  // High-quality pattern: source + signal + persona that leads to booked/replied
  if (feedback.outcome === 'success' && quality >= 85) {
    await recordGtmMemory(supabase, {
      userId: feedback.metadata?.userId as string ?? 'system',
      clientId: feedback.metadata?.clientId as string | null ?? null,
      scope: 'performance',
      memoryType: 'quality_pattern',
      content: `Strong pattern: source=${sourceName} signal=${signalType} persona=${personaType} → quality=${quality}. This combination reliably drives positive outcomes.`,
      source: 'self_improvement',
      confidence: Math.min(1, quality / 100 + 0.2),
      provenance: {
        agentId: feedback.agentId,
        role,
        signalType,
        sourceName,
        personaType,
        qualityScore: quality,
        outcome: feedback.outcome,
      },
    })
  }

  // Failure pattern
  if (feedback.outcome === 'failure') {
    const taxonomy = feedback.errorReason
      ? classifyFailureTaxonomy({ status: 'failed', reasons: [feedback.errorReason], errorMessage: null })
      : 'unknown'

    await recordGtmMemory(supabase, {
      userId: feedback.metadata?.userId as string ?? 'system',
      clientId: feedback.metadata?.clientId as string | null ?? null,
      scope: 'performance',
      memoryType: 'failure_pattern',
      content: `Failure pattern: source=${sourceName} signal=${signalType} taxonomy=${taxonomy} error=${feedback.errorReason ?? 'unknown'}. Avoid this combination or apply guard before dispatch.`,
      source: 'self_improvement',
      confidence: 0.8,
      provenance: {
        agentId: feedback.agentId,
        role,
        signalType,
        sourceName,
        taxonomy,
        errorReason: feedback.errorReason,
      },
    })
  }
}

// ─── Tuning Hint Derivation ───────────────────────────────────────────────────

export async function deriveTuningHint(
  supabase: SupabaseClient,
  feedback: AgentFeedback,
  role: AgentRole,
): Promise<AgentTuningHint | null> {
  if (!feedback.signalType && !feedback.sourceName) return null

  const hint: AgentTuningHint = {
    agentId: feedback.agentId,
    role,
    signalType: feedback.signalType,
  }

  // Adjust source multipliers based on outcomes
  if (feedback.sourceName) {
    const sourceBoost: Record<string, number> = {}
    if (feedback.outcome === 'success') {
      sourceBoost[feedback.sourceName] = 1.05  // slight boost for good sources
    } else if (feedback.outcome === 'failure') {
      sourceBoost[feedback.sourceName] = 0.85  // demote failing sources
    }
    if (Object.keys(sourceBoost).length > 0) {
      hint.sourceBoost = sourceBoost
    }
  }

  // Adjust persona (contact title) multipliers
  if (feedback.personaType) {
    const personaBoost: Record<string, number> = {}
    if (feedback.outcome === 'success' && feedback.qualityScore >= 90) {
      personaBoost[feedback.personaType] = 1.08
    } else if (feedback.outcome === 'failure') {
      personaBoost[feedback.personaType] = 0.9
    }
    if (Object.keys(personaBoost).length > 0) {
      hint.personaBoost = personaBoost
    }
  }

  // For match agent: adjust signal type ranking
  if (role === 'match' && feedback.signalType) {
    const signalScoreDelta = feedback.outcome === 'success'
      ? (feedback.qualityScore - 75) * 0.02  // ±0.3 per 10pt above/below 75
      : -0.1

    if (Math.abs(signalScoreDelta) >= 0.05) {
      hint.parameterAdjustment = {
        [`signalType:${feedback.signalType}:rank_boost`]: signalScoreDelta,
      }
    }

    // Confidence threshold tuning
    const currentThreshold = 0.5
    const adjustment = feedback.outcome === 'success' && feedback.qualityScore >= 90
      ? 0.02  // raise bar slightly when doing well
      : feedback.outcome === 'failure'
        ? -0.03  // lower bar when failure rate is high
        : 0

    if (adjustment !== 0) {
      hint.confidenceThreshold = Math.max(0.3, Math.min(0.8, currentThreshold + adjustment))
    }
  }

  return hint
}

// ─── Batch Tuning (runs periodically, e.g. daily) ──────────────────────────────

export async function computeGlobalTuningHints(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
): Promise<AgentTuningHint[]> {
  // Aggregate eval traces for last 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('gtm_eval_traces')
    .select('trace_type, status, score, failure_taxonomy, reasons, metadata')
    .eq('user_id', userId)
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(500)

  if (clientId) query = query.eq('client_id', clientId)

  const { data: traces } = await query

  if (!traces || traces.length === 0) return []

  // Group by signal_type from metadata
  const bySignalType = new Map<string, { total: number; passed: number; failed: number; avgScore: number }>()
  const bySource = new Map<string, { total: number; passed: number; failed: number }>()

  for (const trace of traces) {
    const meta = (trace.metadata ?? {}) as Record<string, unknown>
    const signalType = (meta.signal_type as string) ?? 'unknown'
    const sourceName = (meta.source_name as string) ?? 'unknown'

    if (!bySignalType.has(signalType)) bySignalType.set(signalType, { total: 0, passed: 0, failed: 0, avgScore: 0 })
    const s = bySignalType.get(signalType)!
    s.total++
    s.avgScore += trace.score ?? 0
    if (trace.status === 'passed') s.passed++
    if (trace.status === 'failed') s.failed++

    if (!bySource.has(sourceName)) bySource.set(sourceName, { total: 0, passed: 0, failed: 0 })
    const so = bySource.get(sourceName)!
    so.total++
    if (trace.status === 'passed') so.passed++
    if (trace.status === 'failed') so.failed++
  }

  const hints: AgentTuningHint[] = []

  // Signal type tuning
  const signalEntries = Array.from(bySignalType.entries())
  for (const [signalType, stats] of signalEntries) {
    const passRate = stats.total > 0 ? stats.passed / stats.total : 0
    const avgScore = stats.avgScore / stats.total

    if (passRate >= 0.75 || passRate <= 0.35) {
      const rankBoost = passRate >= 0.75 ? 0.08 : -0.1
      hints.push({
        agentId: 'match-agent',
        role: 'match',
        signalType,
        parameterAdjustment: {
          [`signalType:${signalType}:rank_boost`]: rankBoost,
          [`signalType:${signalType}:avg_score`]: Math.round(avgScore),
        },
        confidenceThreshold: passRate >= 0.8 ? 0.55 : passRate <= 0.3 ? 0.4 : undefined,
      })
    }
  }

  // Source reliability tuning
  const sourceEntries = Array.from(bySource.entries())
  for (const [source, stats] of sourceEntries) {
    const passRate = stats.total > 0 ? stats.passed / stats.total : 0
    if (passRate >= 0.8) {
      hints.push({
        agentId: 'match-agent',
        role: 'match',
        sourceBoost: { [source]: 1.1 },
      })
    } else if (passRate <= 0.4) {
      hints.push({
        agentId: 'match-agent',
        role: 'match',
        sourceBoost: { [source]: 0.75 },
      })
    }
  }

  return hints
}

// ─── Health Recovery ───────────────────────────────────────────────────────────

export async function checkAndRecoverAgentHealth(
  supabase: SupabaseClient,
  role: AgentRole,
): Promise<void> {
  const agent = getAgent(role)
  if (!agent) return

  // If agent has been degraded too long, try to restore
  if (agent.health.status === 'degraded' && agent.health.consecutiveFailures >= 5) {
    // Reset failure count and mark as recovering
    updateAgentHealth(role, {
      status: 'idle',
      consecutiveFailures: 0,
    })
  }
}

export async function recordAgentFailure(role: AgentRole, errorMessage: string): Promise<void> {
  const agent = getAgent(role)
  if (!agent) return

  const failures = (agent.health.consecutiveFailures ?? 0) + 1
  updateAgentHealth(role, {
    status: failures >= 5 ? 'degraded' : 'running',
    consecutiveFailures: failures,
  })

  // Don't try to write to memory with null supabase in production — just log
  console.error(`[self-improvement] Agent ${role} failed ${failures}x: ${errorMessage.slice(0, 200)}`)
}

// ─── Per-Agent Quality Scoring ─────────────────────────────────────────────────

export interface AgentQualityScore {
  agentId: string
  role: AgentRole
  tasksCompleted: number
  tasksFailed: number
  avgQualityScore: number          // 0-100 from eval traces
  avgLatencyMs: number
  improvementVelocity: number      // quality trend: positive = improving
  lastEvalAt: string | null
}

/**
 * Computes per-agent quality scores from eval traces.
 * Returns a map of agent role → quality score.
 */
export async function computePerAgentQualityScores(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
): Promise<AgentQualityScore[]> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()

  let query = supabase
    .from('gtm_eval_traces')
    .select('status, score, metadata, created_at')
    .eq('user_id', userId)
    .gte('created_at', fourteenDaysAgo)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (clientId) query = query.eq('client_id', clientId)

  const { data: traces } = await query

  if (!traces || traces.length === 0) return []

  // Group by agent role from metadata
  const byAgent = new Map<string, {
    roles: AgentRole[]
    scores: number[]
    latencies: number[]
    completed: number
    failed: number
    recentScores: number[]
    lastEvalAt: string
  }>()

  for (const trace of traces) {
    const meta = (trace.metadata ?? {}) as Record<string, unknown>
    const agentId = (meta.agentId as string) ?? (meta.role as string) ?? 'unknown'
    const role = (meta.role as AgentRole) ?? 'operator'

    if (!byAgent.has(agentId)) {
      byAgent.set(agentId, { roles: [], scores: [], latencies: [], completed: 0, failed: 0, recentScores: [], lastEvalAt: trace.created_at })
    }

    const ag = byAgent.get(agentId)!
    if (!ag.roles.includes(role)) ag.roles.push(role)
    if (trace.score != null) {
      ag.scores.push(trace.score)
      // Separate recent (7 days) for velocity
      const traceDate = new Date(trace.created_at)
      if (Date.now() - traceDate.getTime() < 7 * 24 * 60 * 60 * 1000) {
        ag.recentScores.push(trace.score)
      }
    }
    if (typeof meta.latencyMs === 'number') ag.latencies.push(meta.latencyMs)
    if (trace.status === 'passed') ag.completed++
    if (trace.status === 'failed') ag.failed++
  }

  // Compute scores
  const results: AgentQualityScore[] = []
  const entries = Array.from(byAgent.entries())
  for (const [agentId, ag] of entries) {
    const avgQuality = ag.scores.length > 0
      ? Math.round(ag.scores.reduce((a, b) => a + b, 0) / ag.scores.length)
      : 0
    const avgLatency = ag.latencies.length > 0
      ? Math.round(ag.latencies.reduce((a, b) => a + b, 0) / ag.latencies.length)
      : 0

    // Velocity: compare recent (7d) avg vs older avg
    const olderScores = ag.scores.slice(ag.recentScores.length)
    const recentAvg = ag.recentScores.length > 0
      ? ag.recentScores.reduce((a, b) => a + b, 0) / ag.recentScores.length
      : 0
    const olderAvg = olderScores.length > 0
      ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length
      : recentAvg
    const velocity = olderAvg > 0
      ? Math.round(((recentAvg - olderAvg) / olderAvg) * 100)
      : 0

    results.push({
      agentId,
      role: ag.roles[0] ?? 'operator',
      tasksCompleted: ag.completed,
      tasksFailed: ag.failed,
      avgQualityScore: avgQuality,
      avgLatencyMs: avgLatency,
      improvementVelocity: velocity,
      lastEvalAt: ag.lastEvalAt,
    })
  }

  // Sort by quality score descending
  results.sort((a, b) => b.avgQualityScore - a.avgQualityScore)
  return results
}

// ─── Per-workspace tuning (v2 reward loop) ────────────────────────────────────

import type { Engine } from '../core/engines'

/**
 * Run one reward-loop cycle for a single workspace + engine: compute tuning
 * hints, apply ICP signal-weight updates (scoped to the workspace), persist the
 * hints, and write a human-readable entry to `workspace_tuning_log`.
 *
 * Outbound hints come from `gtm_eval_traces`; content hints come from
 * `content_engagement` traces once the Content engine is live (Phase 2).
 */
export async function applyWorkspaceTuning(
  supabase: SupabaseClient,
  opts: { workspaceId: string; userId: string; clientId: string | null; engine: Engine },
): Promise<{ hints: number; changes: string[] }> {
  const changes: string[] = []

  // 1) compute hints (currently outbound-trace driven; content reuses same shape)
  const hints = await computeGlobalTuningHints(supabase, opts.userId, opts.clientId)

  // 2) apply + persist
  for (const hint of hints) {
    if (hint.signalType && hint.parameterAdjustment) {
      const boostKey = Object.keys(hint.parameterAdjustment).find((k) => k.includes('rank_boost'))
      const delta = boostKey ? Number(hint.parameterAdjustment[boostKey]) : NaN
      if (!Number.isNaN(delta)) {
        // read current weight for this workspace+signal, default 1.0
        const { data: existing } = await supabase
          .from('gtm_icp_signals')
          .select('id, weight')
          .eq('workspace_id', opts.workspaceId)
          .eq('signal_type', hint.signalType)
          .maybeSingle()
        const current = typeof existing?.weight === 'number' ? existing.weight : 1.0
        const next = Math.max(0.2, Math.min(3.0, current + delta))
        await supabase.from('gtm_icp_signals').upsert(
          {
            workspace_id: opts.workspaceId,
            user_id: opts.userId,
            signal_type: hint.signalType,
            name: hint.signalType,
            weight: next,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,signal_type' },
        )
        changes.push(`signal "${hint.signalType}" weight ${current.toFixed(2)} → ${next.toFixed(2)}`)
      }
    }
    await supabase.from('agent_tuning_hints').insert({
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      engine: opts.engine,
      agent_name: hint.agentId,
      agent_role: hint.role,
      signal_type: hint.signalType ?? null,
      hint_type: hint.signalType ? 'signal_weight' : hint.sourceBoost ? 'source_boost' : 'param_adjust',
      new_weight: hint.newWeight ?? null,
      new_priority: hint.newPriority ?? null,
      confidence: hint.confidenceThreshold ?? null,
      rationale: hint.sourceBoost
        ? `source reliability adjustment: ${JSON.stringify(hint.sourceBoost)}`
        : hint.signalType
          ? `signal pass-rate tuning for "${hint.signalType}"`
          : 'parameter adjustment',
      metadata: { sourceBoost: hint.sourceBoost ?? null, personaBoost: hint.personaBoost ?? null, parameterAdjustment: hint.parameterAdjustment ?? null },
      applied_at: new Date().toISOString(),
    })
  }

  // 3) log the cycle (skip empty cycles to keep the log readable)
  if (changes.length > 0 || hints.length > 0) {
    await supabase.from('workspace_tuning_log').insert({
      workspace_id: opts.workspaceId,
      user_id: opts.userId,
      engine: opts.engine,
      summary: changes.length
        ? `Reward loop applied ${changes.length} change(s): ${changes.slice(0, 4).join('; ')}${changes.length > 4 ? '…' : ''}`
        : `Reward loop ran — ${hints.length} hint(s) computed, no threshold crossed`,
      changes,
      cycle_at: new Date().toISOString(),
    })
  }

  return { hints: hints.length, changes }
}

/** Distinct active workspaces (user_id-keyed) with agent activity in the last `days` days. */
export async function listActiveWorkspaces(
  supabase: SupabaseClient,
  days = 7,
): Promise<Array<{ workspaceId: string; userId: string; clientId: string | null }>> {
  const since = new Date(Date.now() - days * 86400_000).toISOString()
  const { data } = await supabase
    .from('agent_runs')
    .select('user_id, client_id')
    .gte('started_at', since)
    .limit(2000)
  const seen = new Map<string, { workspaceId: string; userId: string; clientId: string | null }>()
  for (const row of data ?? []) {
    const userId = row.user_id as string
    const clientId = (row.client_id as string | null) ?? null
    const workspaceId = clientId ?? userId
    if (!seen.has(workspaceId)) seen.set(workspaceId, { workspaceId, userId, clientId })
  }
  return [...seen.values()]
}
