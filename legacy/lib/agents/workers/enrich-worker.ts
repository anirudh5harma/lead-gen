/**
 * Enrich Agent Worker — handles contact enrichment and email verification.
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
      case 'bombsell.enrich.contacts': {
        const { targetCompany, companyDomain } = args as {
          targetCompany: string
          companyDomain?: string | null
        }

        if (!targetCompany) {
          throw new Error('enrich.contacts requires a targetCompany')
        }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'enrich',
          eventType: 'enrich.contacts.started',
          status: 'running',
          title: `Enriching contacts for ${targetCompany}`,
        })

        const { enrichCompany } = await import('@/lib/email-finder/enrich')
        const enrichResult = await enrichCompany(
          targetCompany,
          companyDomain ?? null,
          supabase,
        )

        result = {
          contactCount: enrichResult.contacts.length,
          contacts: enrichResult.contacts,
          resolvedDomain: enrichResult.resolvedDomain,
          fromCache: enrichResult.fromCache,
        }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'enrich',
          eventType: 'enrich.contacts.completed',
          status: 'completed',
          title: `Enriched ${enrichResult.contacts.length} contacts for ${targetCompany}`,
          metadata: { contactCount: enrichResult.contacts.length },
        })
        break
      }

      case 'bombsell.enrich.verify': {
        const { emails } = args as { emails: string[] }

        if (!Array.isArray(emails) || emails.length === 0) {
          throw new Error('enrich.verify requires an emails array')
        }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'enrich',
          eventType: 'enrich.verify.started',
          status: 'running',
          title: `Verifying ${emails.length} email(s)`,
        })

        const { verifyEmailCandidates } = await import('@/lib/email-finder/smtp-verify')
        const verified = await verifyEmailCandidates(emails)

        result = { verified }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'enrich',
          eventType: 'enrich.verify.completed',
          status: 'completed',
          title: `Verified ${verified.length}/${emails.length} email(s)`,
          metadata: { total: emails.length, verified: verified.length },
        })
        break
      }

      default:
        throw new Error(`Unknown enrich tool: ${tool}`)
    }

    return {
      taskId: dispatch.taskId,
      traceId: dispatch.tracingContext.traceId,
      status: 'completed',
      result,
      creditsConsumed: 0.1,
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
