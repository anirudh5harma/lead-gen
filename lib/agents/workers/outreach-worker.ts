/**
 * Outreach Agent Worker — handles draft generation, send execution, and draft quality evaluation.
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
      case 'bombsell.outreach.draft': {
        const {
          leadId,
          subject = '',
          body = '',
          greeting,
          stakeholders: rawStakeholders = [],
        } = args as {
          leadId: string
          subject?: string
          body?: string
          greeting?: string | null
          stakeholders?: unknown[]
        }

        if (!leadId) {
          throw new Error('outreach.draft requires a leadId')
        }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'outreach',
          eventType: 'outreach.draft.started',
          status: 'running',
          title: 'Drafting outreach message',
        })

        const { upsertOutreachDraft } = await import('@/lib/outreach-workflow')
        const draft = await upsertOutreachDraft(supabase, {
          leadId,
          userId,
          clientId,
          subject,
          body,
          stakeholders: Array.isArray(rawStakeholders)
            ? rawStakeholders.map((stakeholder: unknown) => {
                const s = stakeholder && typeof stakeholder === 'object'
                  ? stakeholder as Record<string, unknown>
                  : {}
                return {
                  name: String(s.name ?? s.email ?? ''),
                  title: String(s.title ?? 'Decision Maker'),
                  email: String(s.email ?? ''),
                  confidence: String(s.confidence ?? 'medium'),
                  source: String(s.source ?? 'agent'),
                }
              })
            : [],
          greeting: greeting ?? null,
        })

        result = { draftId: draft.subject }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'outreach',
          eventType: 'outreach.draft.completed',
          status: 'completed',
          title: 'Outreach draft saved',
          metadata: { draftId: draft.subject },
        })
        break
      }

      case 'bombsell.outreach.send': {
        const { leadId } = args as { leadId: string }

        if (!leadId) {
          throw new Error('outreach.send requires a leadId')
        }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'outreach',
          eventType: 'outreach.send.started',
          status: 'running',
          title: 'Sending outreach email',
        })

        // Fetch the lead to get the recipient email and name
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .select('contact_email, contact_name, target_company')
          .eq('id', leadId)
          .eq('user_id', userId)
          .maybeSingle()

        if (leadError || !lead?.contact_email) {
          throw new Error(leadError?.message || 'Lead has no contact email')
        }

        // Fetch the draft for subject and body
        const { data: draft } = await supabase
          .from('outreach_drafts')
          .select('subject, body')
          .eq('lead_id', leadId)
          .maybeSingle()

        const subject = typeof draft?.subject === 'string' ? draft.subject : 'Quick question'
        const body = typeof draft?.body === 'string' ? draft.body : 'Hi, I wanted to reach out.'
        const toEmail = String(lead.contact_email)
        const toName = typeof lead.contact_name === 'string' ? lead.contact_name : 'there'

        const { pickSenderAccount, sendWithConnectedAccount } = await import('@/lib/oauth/sender')

        const sender = await pickSenderAccount(userId, supabase)
        if (!sender) {
          throw new Error('No connected sending account found')
        }

        const sendResult = await sendWithConnectedAccount({
          userId,
          supabase,
          to: toEmail,
          subject,
          body,
          fromName: sender.display_name || sender.email,
        })

        if (!sendResult) {
          throw new Error('Failed to send email — no send result returned')
        }

        result = { sent: true, messageId: sendResult.messageId }

        await recordAgentEvent(supabase, {
          userId, clientId, leadId,
          agentName: 'outreach',
          eventType: 'outreach.send.completed',
          status: 'completed',
          title: `Outreach sent to ${toName}`,
          metadata: { messageId: sendResult.messageId, provider: sendResult.provider },
        })
        break
      }

      case 'bombsell.outreach.eval_draft': {
        const {
          subject,
          body,
          greeting,
          targetCompany,
          signalType,
          signalSummary,
        } = args as {
          subject: string
          body: string
          greeting: string
          targetCompany: string
          signalType?: string | null
          signalSummary?: string | null
        }

        if (!subject || !body || !greeting || !targetCompany) {
          throw new Error('outreach.eval_draft requires subject, body, greeting, and targetCompany')
        }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'outreach',
          eventType: 'outreach.eval_draft.started',
          status: 'running',
          title: `Evaluating draft quality for ${targetCompany}`,
        })

        const { evaluateOutreachDraftQuality } = await import('@/lib/gtm/draft-eval')
        const evaluation = evaluateOutreachDraftQuality({
          subject,
          body,
          greeting,
          targetCompany,
          signalType: signalType ?? null,
          signalSummary: signalSummary ?? null,
        })

        result = {
          score: evaluation.score,
          checks: evaluation.checks,
          failed: evaluation.failed,
          version: evaluation.version,
        }

        await recordAgentEvent(supabase, {
          userId, clientId,
          agentName: 'outreach',
          eventType: 'outreach.eval_draft.completed',
          status: 'completed',
          title: `Draft evaluated — score: ${evaluation.score}`,
          metadata: { score: evaluation.score, failed: evaluation.failed },
        })
        break
      }

      default:
        throw new Error(`Unknown outreach tool: ${tool}`)
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
