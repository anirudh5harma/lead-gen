/**
 * Safety Agent Worker — handles outbound policy evaluation and simulation.
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
      case 'bombsell.safety.check': {
        const { leadId } = args as { leadId: string }

        if (!leadId) {
          throw new Error('safety.check requires a leadId')
        }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'safety',
          eventType: 'safety.check.started',
          status: 'running',
          title: 'Running outbound safety check',
        })

        // Fetch the lead to build the policy input
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select(
            'target_company, company_domain, status, is_unlocked, contact_email, contact_verified, contact_name',
          )
          .eq('id', leadId)
          .eq('user_id', userId)
          .maybeSingle()

        if (leadError || !lead) {
          throw new Error(leadError?.message || `Lead ${leadId} not found`)
        }

        const recipientEmails: string[] = []
        if (typeof lead.contact_email === 'string' && lead.contact_email) {
          recipientEmails.push(lead.contact_email)
        }

        const { evaluateOutboundPolicy } = await import('@/lib/policies/outbound')
        const decision = await evaluateOutboundPolicy(supabase, {
          userId,
          clientId,
          leadId,
          targetCompany: String(lead.target_company ?? ''),
          companyDomain: typeof lead.company_domain === 'string' ? lead.company_domain : null,
          status: typeof lead.status === 'string' ? lead.status : null,
          isUnlocked: lead.is_unlocked === true,
          contactVerified: lead.contact_verified === true,
          recipientValidationSafe: null,
          recipientEmails,
        })

        result = {
          decision: decision.decision,
          reasons: decision.reasons,
        }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'safety',
          eventType: 'safety.check.completed',
          status: decision.decision === 'allowed' ? 'completed' : 'blocked',
          title: `Safety check: ${decision.decision}`,
          metadata: { decision: decision.decision, reasons: decision.reasons },
        })
        break
      }

      case 'bombsell.safety.simulate': {
        const { leadId } = args as { leadId: string }

        if (!leadId) {
          throw new Error('safety.simulate requires a leadId')
        }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'safety',
          eventType: 'safety.simulate.started',
          status: 'running',
          title: 'Running outbound safety simulation',
        })

        // Fetch the lead to build the policy input
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select(
            'target_company, company_domain, status, is_unlocked, contact_email, contact_verified, contact_name',
          )
          .eq('id', leadId)
          .eq('user_id', userId)
          .maybeSingle()

        if (leadError || !lead) {
          throw new Error(leadError?.message || `Lead ${leadId} not found`)
        }

        const recipientEmails: string[] = []
        if (typeof lead.contact_email === 'string' && lead.contact_email) {
          recipientEmails.push(lead.contact_email)
        }

        const { simulateOutboundPolicy } = await import('@/lib/policies/outbound')
        const decision = await simulateOutboundPolicy(supabase, {
          userId,
          clientId,
          leadId,
          targetCompany: String(lead.target_company ?? ''),
          companyDomain: typeof lead.company_domain === 'string' ? lead.company_domain : null,
          status: typeof lead.status === 'string' ? lead.status : null,
          isUnlocked: lead.is_unlocked === true,
          contactVerified: lead.contact_verified === true,
          recipientValidationSafe: null,
          recipientEmails,
          runId: dispatch.tracingContext.workflowRunId ?? null,
          agentRunId: dispatch.taskId,
          metadata: {
            source: 'safety_worker',
            taskId: dispatch.taskId,
            sessionId: dispatch.sessionId,
          },
        })

        result = {
          decision: decision.decision,
          reasons: decision.reasons,
        }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'safety',
          eventType: 'safety.simulate.completed',
          status: 'completed',
          title: `Safety simulation: ${decision.decision}`,
          metadata: { decision: decision.decision, reasons: decision.reasons },
        })
        break
      }

      default:
        throw new Error(`Unknown safety tool: ${tool}`)
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
