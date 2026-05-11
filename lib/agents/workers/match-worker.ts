/**
 * Match Agent Worker — handles ICP matching and candidate ranking.
 * Each method maps to a dispatchable tool in the supervisor.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { startCronRun, finishCronRun } from '@/lib/cron-runs'
import { recordAgentEvent } from '@/lib/agent-events'
import type { WorkerTaskDispatch, WorkerTaskResult } from '../protocol/types'

export async function run(
  supabase: SupabaseClient,
  dispatch: WorkerTaskDispatch,
  userId: string,
  clientId: string | null,
): Promise<WorkerTaskResult> {
  const start = Date.now()
  const { tool, args } = dispatch

  try {
    let result: Record<string, unknown>

    switch (tool) {
      case 'bombsell.match.candidates': {
        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'match',
          eventType: 'match.candidates.started',
          status: 'running',
          title: 'Match candidates cron started',
        })
        const runId = await startCronRun(supabase, 'match_leads_agent')
        const stats = { triggered: true, run_id: runId }
        await finishCronRun(supabase, runId, { status: 'success', metrics: stats })
        result = stats
        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'match',
          eventType: 'match.candidates.completed',
          status: 'completed',
          title: 'Match candidates cron completed',
          metadata: { stats },
        })
        break
      }

      case 'bombsell.match.rank': {
        const { candidates } = args as {
          candidates: Array<{
            company_name: string
            signal_type: string
            source_name: string
          }>
        }

        if (!Array.isArray(candidates)) {
          throw new Error('match.rank requires a candidates array')
        }

        const { scoreProfileCandidate } = await import('@/lib/match-candidates')
        const now = new Date().toISOString()

        const scored = candidates.map((c, i) => {
          const signalObj = {
            id: `cand_${i}_${Date.now()}`,
            company_name: c.company_name,
            company_domain: null as string | null,
            novelty_key: null as string | null,
            signal_type: c.signal_type,
            summary: null as string | null,
            headline: null as string | null,
            published_at: now,
            source_name: c.source_name,
            cluster_score: 0,
            corroborating_source_count: 1,
          }
          const score = scoreProfileCandidate({ signal: signalObj })
          return { ...c, score, signal: signalObj }
        })

        result = { scored }
        break
      }

      default:
        throw new Error(`Unknown match tool: ${tool}`)
    }

    return {
      taskId: dispatch.taskId,
      traceId: dispatch.tracingContext.traceId,
      status: 'completed',
      result,
      creditsConsumed: 0.05,
      latencyMs: Date.now() - start,
    }
  } catch (err) {
    return {
      taskId: dispatch.taskId,
      traceId: dispatch.tracingContext.traceId,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      creditsConsumed: 0,
      latencyMs: Date.now() - start,
    }
  }
}
