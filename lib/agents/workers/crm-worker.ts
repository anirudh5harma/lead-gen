/**
 * CRM Agent Worker — handles CRM sync, export, and memory management.
 * Each method maps to a dispatchable tool in the supervisor.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordAgentEvent } from '@/lib/agent-events'
import type { WorkerTaskDispatch, WorkerTaskResult } from '../protocol/types'

const STATUS_TO_CRM_EVENT: Record<string, 'lead.created' | 'lead.updated' | 'lead.sent' | 'lead.replied' | 'lead.booked'> = {
  sent: 'lead.sent',
  replied: 'lead.replied',
  booked: 'lead.booked',
  created: 'lead.created',
  updated: 'lead.updated',
}

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
      case 'bombsell.crm.sync': {
        const { leadId, status } = args as { leadId: string; status: string }
        const eventType = STATUS_TO_CRM_EVENT[status] ?? 'lead.updated'

        await recordAgentEvent(supabase, {
          userId,
          clientId,
          agentName: 'crm',
          eventType: 'crm.sync.started',
          status: 'running',
          title: `CRM sync started for lead ${leadId}`,
        })

        const { emitCrmLeadEvent } = await import('@/lib/crm-sync')
        await emitCrmLeadEvent({
          userId,
          clientId,
          eventType,
          payload: { leadId, status },
        })

        result = { synced: true, leadId, eventType }

        await recordAgentEvent(supabase, {
          userId,
          clientId,
          agentName: 'crm',
          eventType: 'crm.sync.completed',
          status: 'completed',
          title: `CRM sync completed for lead ${leadId}`,
          metadata: { leadId, eventType, status },
        })
        break
      }

      case 'bombsell.crm.export': {
        const { leadId } = args as { leadId: string; provider?: string; feed?: string }

        await recordAgentEvent(supabase, {
          userId,
          clientId,
          agentName: 'crm',
          eventType: 'crm.export.started',
          status: 'running',
          title: `CRM export started for lead ${leadId}`,
        })

        // Resolve the lead to build an export record
        const { data: lead } = await supabase
          .from('leads')
          .select('target_company, company_domain, contact_email, contact_name, contact_title, status, created_at')
          .eq('id', leadId)
          .eq('user_id', userId)
          .single()

        if (lead) {
          const { buildCrmExportRecord, buildCrmExportCsv, normalizeCrmProvider } = await import('@/lib/crm-sync')

          const record = buildCrmExportRecord({
            company: lead.target_company ?? 'Unknown',
            domain: lead.company_domain ?? null,
            contactName: lead.contact_name ?? null,
            contactTitle: lead.contact_title ?? null,
            contactEmail: lead.contact_email ?? null,
            status: lead.status ?? null,
            createdAt: lead.created_at ?? null,
          })

          const provider = (args as { provider?: string }).provider ?? 'webhook'
          const csv = buildCrmExportCsv(provider, [record])
          result = { exported: true, leadId, provider: normalizeCrmProvider(provider), csv }
        } else {
          result = { exported: true, leadId, note: 'Lead not found, skipped export' }
        }

        await recordAgentEvent(supabase, {
          userId,
          clientId,
          agentName: 'crm',
          eventType: 'crm.export.completed',
          status: 'completed',
          title: `CRM export completed for lead ${leadId}`,
          metadata: { leadId },
        })
        break
      }

      default:
        throw new Error(`Unknown CRM tool: ${tool}`)
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
