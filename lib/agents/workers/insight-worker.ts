/**
 * Insight Agent Worker — handles analytics insight listing and lazy generation.
 * Each method maps to a dispatchable tool in the supervisor.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
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
      case 'bombsell.insight.list': {
        const { listGtmInsights } = await import('@/lib/gtm/insights')
        const { limit } = args as { limit?: number }
        const insights = await listGtmInsights(supabase, { userId, clientId, limit })
        result = insights
        break
      }

      case 'bombsell.insight.generate': {
        // Insights are generated lazily on list; just confirm trigger
        result = { triggered: true }
        break
      }

      default:
        throw new Error(`Unknown insight tool: ${tool}`)
    }

    return {
      taskId: dispatch.taskId,
      traceId: dispatch.tracingContext.traceId,
      status: 'completed',
      result,
      creditsConsumed: 0.03,
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
