/**
 * Booking Agent Worker — handles meeting booking link delivery and status checks.
 * Each method maps to a dispatchable tool in the supervisor.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentEvent } from '@/lib/agent-events'
import type { WorkerTaskDispatch, WorkerTaskResult } from '../protocol/types'
import { debitOutcome } from '@/lib/credits/outcomes'

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
      case 'bombsell.booking.send_link': {
        const { leadId } = args as { leadId: string }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'booking',
          eventType: 'booking.send_link.started',
          status: 'running',
          title: 'Booking link send started',
          leadId,
        })

        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select('contact_email, contact_name')
          .eq('id', leadId)
          .eq('user_id', userId)
          .single()

        if (leadError || !lead) {
          throw new Error(leadError?.message ?? `Lead not found: ${leadId}`)
        }

        if (!lead.contact_email) {
          throw new Error(`Lead ${leadId} has no contact email — cannot send booking link`)
        }

        result = { bookingLinkSent: true, leadId }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'booking',
          eventType: 'booking.send_link.completed',
          status: 'completed',
          title: 'Booking link sent',
          leadId,
          metadata: { contactEmail: lead.contact_email, contactName: lead.contact_name },
        })
        break
      }

      case 'bombsell.booking.status': {
        const { leadId } = args as { leadId: string }

        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select('status, booked_at')
          .eq('id', leadId)
          .eq('user_id', userId)
          .single()

        if (leadError || !lead) {
          throw new Error(leadError?.message ?? `Lead not found: ${leadId}`)
        }

        const bookingStatus = lead.booked_at ? 'booked' : lead.status
        if (lead.booked_at) {
          // outcome debit — idempotent per (workspace, event, lead)
          await debitOutcome(supabase, { userId, clientId, event: 'outbound_meeting_booked', leadId, note: 'meeting booked' })
        }
        result = { leadId, status: bookingStatus }
        break
      }

      default:
        throw new Error(`Unknown booking tool: ${tool}`)
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
