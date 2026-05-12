/**
 * Reply Agent Worker — handles reply classification and intent detection.
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
      case 'bombsell.reply.classify': {
        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'reply',
          eventType: 'reply.classify.started',
          status: 'running',
          title: 'Reply classification started',
        })

        const { classifyReplyIntent } = await import('@/lib/reply-intelligence')
        const { subject, text, leadId } = args as { subject: string; text: string; leadId?: string }
        const intent = classifyReplyIntent({ subject, text })
        result = { intent: intent.intent, summary: intent.summary }

        // outcome debit on positive intent (idempotent per lead)
        const it = String(intent.intent)
        if (leadId && (it === 'meeting_requested' || it === 'interested' || it === 'meeting_booked')) {
          const { debitOutcome } = await import('@/lib/credits/outcomes')
          await debitOutcome(supabase, { userId, clientId, event: 'outbound_positive_reply', leadId, note: `positive reply (${it})` })
        }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'reply',
          eventType: 'reply.classify.completed',
          status: 'completed',
          title: 'Reply classification completed',
          metadata: { intent: intent.intent, summary: intent.summary },
        })
        break
      }

      default:
        throw new Error(`Unknown reply tool: ${tool}`)
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
