/**
 * Self-Improvement Cron — runs the agent feedback → tuning loop.
 *
 * Schedule: every 15 minutes
 * Actions:
 *   1. Ingest any new agent feedback from the agent_events table
 *   2. Compute updated tuning hints per agent
 *   3. Apply ICP signal weight adjustments to gtm_icp_signals if thresholds are met
 *   4. Check agent health and recover degraded agents
 *
 * POST /api/cron/agent-self-improvement
 * Query params:
 *   secret=xxx  — cron secret for authentication
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ingestAgentFeedback, computeGlobalTuningHints, checkAndRecoverAgentHealth, computePerAgentQualityScores, applyWorkspaceTuning, listActiveWorkspaces } from '@/lib/agents/self-improvement/engine'
import { listAgents } from '@/lib/agents/core/registry'
import type { AgentRole } from '@/lib/agents/protocol/types'

const CRON_SECRET = process.env['CRON_SECRET'] ?? 'bombsell-dev-cron-secret'

export async function POST(request: NextRequest) {
  // ── Auth (query secret OR Vercel cron Bearer header) ───────────────────────
  const secret = request.nextUrl.searchParams.get('secret')
  const bearer = request.headers.get('authorization')
  if (secret !== CRON_SECRET && bearer !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()
  const results: string[] = []
  const errors: string[] = []

  // ── 1. Ingest recent agent feedback ────────────────────────────────────────
  try {
    const recentEvents = await supabase
      .from('agent_events')
      .select('*')
      .eq('event_type', 'task.completed')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(100)

    if (recentEvents.data && recentEvents.data.length > 0) {
      for (const event of recentEvents.data) {
        const meta = event.metadata as Record<string, unknown> | null
        if (meta?.result) {
          await ingestAgentFeedback(supabase, {
            agentId: event.agent_name,
            taskId: (meta.taskId as string) ?? event.id,
            traceId: `cron-${event.id}`,
            outcome: 'success',
            qualityScore: 85,
            metadata: { latencyMs: typeof meta.latencyMs === 'number' ? meta.latencyMs : undefined },
          })
        }
      }
      results.push(`Ingested ${recentEvents.data.length} recent feedback events`)
    }
  } catch (e) {
    errors.push(`Feedback ingestion: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 2. Compute tuning hints ────────────────────────────────────────────────
  try {
    const hints = await computeGlobalTuningHints(supabase, 'system', null)
    if (hints.length > 0) {
      results.push(`Computed ${hints.length} tuning hints`)
      for (const hint of hints) {
        // Apply signal weight adjustments to ICP signals
        if (hint.signalType && hint.parameterAdjustment) {
          // Extract rank_boost from parameterAdjustment map
          const rankBoostKey = Object.keys(hint.parameterAdjustment).find(k => k.includes('rank_boost'))
          const newWeight = rankBoostKey ? Number(hint.parameterAdjustment[rankBoostKey]) : null
          if (newWeight !== null && !isNaN(newWeight)) {
            const { error } = await supabase
              .from('gtm_icp_signals')
              .update({ weight: newWeight, updated_at: new Date().toISOString() })
              .eq('name', hint.signalType)

            if (!error) results.push(`Updated ICP signal weight: ${hint.signalType} → ${newWeight.toFixed(2)}`)
          }
        }
        // Record tuning hint to DB
        await supabase.from('agent_tuning_hints').upsert({
          agent_name: hint.agentId,
          signal_type: hint.signalType ?? null,
          hint_type: hint.signalType ? 'signal_weight' : hint.sourceBoost ? 'source_boost' : 'param_adjust',
          new_weight: hint.signalType && hint.parameterAdjustment
            ? Object.values(hint.parameterAdjustment)[0] as number ?? null
            : null,
          new_priority: hint.newPriority ?? null,
          metadata: {
            role: hint.role,
            confidence: hint.confidenceThreshold,
            sourceBoost: hint.sourceBoost ?? null,
            personaBoost: hint.personaBoost ?? null,
          },
        }).eq('agent_name', hint.agentId)
      }
    } else {
      results.push('No tuning hints computed (insufficient data)')
    }
  } catch (e) {
    errors.push(`Tuning hints computation: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 2b. Per-workspace reward loop ───────────────────────────────────────────
  try {
    const workspaces = await listActiveWorkspaces(supabase, 7)
    let tuned = 0
    let totalChanges = 0
    for (const ws of workspaces) {
      try {
        const r = await applyWorkspaceTuning(supabase, {
          workspaceId: ws.workspaceId, userId: ws.userId, clientId: ws.clientId, engine: 'outbound',
        })
        if (r.hints > 0 || r.changes.length > 0) tuned++
        totalChanges += r.changes.length
      } catch (e) {
        errors.push(`Workspace tuning ${ws.workspaceId}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    results.push(`Per-workspace reward loop: ${workspaces.length} active workspaces, ${tuned} tuned, ${totalChanges} changes applied`)
  } catch (e) {
    errors.push(`Per-workspace reward loop: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 3. Health check and recovery — all agent roles ──────────────────────
  try {
    const allRoles: AgentRole[] = ['signal','match','enrich','outreach','safety','reply','booking','followup','insight','crm','operator','idea','writer','editor','publisher','engagement','repurpose']
    const recovered: string[] = []
    for (const role of allRoles) {
      try {
        await checkAndRecoverAgentHealth(supabase, role)
      } catch { /* agent may not be recoverable */ }
    }
    if (recovered.length > 0) {
      results.push(`Recovered agents: ${recovered.join(', ')}`)
    }
  } catch (e) {
    errors.push(`Health recovery: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 4. Per-agent quality scores ─────────────────────────────────────────
  try {
    const qualityScores = await computePerAgentQualityScores(supabase, 'system', null)
    if (qualityScores.length > 0) {
      const top = qualityScores.slice(0, 3)
      results.push(`Agent quality: ${qualityScores.length} agents scored. Top: ${top.map(q => `${q.role}(${q.avgQualityScore})`).join(', ')}`)
    } else {
      results.push('Agent quality: no eval traces yet')
    }
  } catch (e) {
    errors.push(`Quality scores: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ── 5. Emit agent stats ─────────────────────────────────────────────────
  try {
    const agents = listAgents()
    const healthy = agents.filter(a => a.health.status === 'running').length
    const degraded = agents.filter(a => a.health.status === 'degraded').length
    results.push(`Agent health: ${healthy} running, ${degraded} degraded, ${agents.length} total`)
  } catch (e) {
    errors.push(`Agent list: ${e instanceof Error ? e.message : String(e)}`)
  }

  return NextResponse.json({
    ok: errors.length === 0,
    timestamp: new Date().toISOString(),
    results,
    errors: errors.length ? errors : undefined,
  })
}

export async function GET(request: NextRequest) {
  // Vercel cron invokes GET with the Bearer secret → run the loop.
  const bearer = request.headers.get('authorization')
  const secret = request.nextUrl.searchParams.get('secret')
  if (bearer === `Bearer ${process.env.CRON_SECRET}` || secret === CRON_SECRET) {
    return POST(request)
  }
  // Otherwise it's just a health probe.
  return NextResponse.json({ service: 'agent-self-improvement', status: 'ok', timestamp: new Date().toISOString() })
}
