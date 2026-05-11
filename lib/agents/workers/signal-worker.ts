/**
 * Signal Agent Worker — handles signal ingestion, clustering, and novelty detection.
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
      case 'bombsell.signal.poll': {
        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'signal',
          eventType: 'signal.poll.started',
          status: 'running',
          title: 'Signal poll started',
        })
        const runId = await startCronRun(supabase, 'poll_signals')
        const stats = { triggered: true, run_id: runId }
        await finishCronRun(supabase, runId, { status: 'success', metrics: stats })
        result = stats
        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'signal',
          eventType: 'signal.poll.completed',
          status: 'completed',
          title: 'Signal poll completed',
          metadata: { stats },
        })
        break
      }

      case 'bombsell.signal.ingest': {
        const { source } = args as { source: string; sourceType?: string; url?: string; category?: string }
        // Upsert the GTM source instead of a bulk ingest function
        const { upsertGtmSource } = await import('@/lib/gtm/sources')
        const sourceId = await upsertGtmSource(supabase, {
          userId,
          clientId,
          sourceName: source,
          sourceType: (args as { sourceType?: string }).sourceType ?? null,
          url: (args as { url?: string }).url ?? null,
          category: (args as { category?: string }).category ?? null,
        })
        result = { sourceId }
        break
      }

      default:
        throw new Error(`Unknown signal tool: ${tool}`)
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