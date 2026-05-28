/**
 * Followup Agent Worker — handles scheduled follow-up orchestration.
 * Each method maps to a dispatchable tool in the supervisor.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
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
      case 'bombsell.followup.schedule': {
        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'followup',
          eventType: 'followup.schedule.started',
          status: 'running',
          title: 'Follow-up scheduling started',
        })

        const { upsertGtmAction } = await import('@/lib/gtm/actions')
        const { leadId, spacingDays } = args as { leadId: string; spacingDays?: number[] }
        const days = spacingDays ?? [3, 7, 14]
        const now = new Date()
        const maxFollowups = Math.min(days.length, 4)

        for (let i = 0; i < maxFollowups; i++) {
          const dueAt = new Date(now.getTime() + (days[i] ?? 7) * 86400 * 1000).toISOString()
          await upsertGtmAction(supabase, {
            userId,
            clientId,
            leadId,
            actionType: 'followup',
            title: `Follow-up #${i + 1}`,
            status: 'waiting',
            dueAt,
            source: 'followup-agent',
            priority: 50 - i * 5,
          })
        }

        result = { scheduled: true, followupCount: maxFollowups }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'followup',
          eventType: 'followup.schedule.completed',
          status: 'completed',
          title: 'Follow-ups scheduled',
          metadata: { leadId, followupCount: maxFollowups, spacingDays: days.slice(0, maxFollowups) },
        })
        break
      }

      default:
        throw new Error(`Unknown followup tool: ${tool}`)
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
