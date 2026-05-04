import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeAutoSendPolicy, policyKey } from '@/lib/auto-send-policies'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { finishCronRun, startCronRun } from '@/lib/cron-runs'
import { resolveOutreachContext } from '@/lib/outreach-context'
import { messageIdHeader } from '@/lib/oauth/message-id'
import { recordAgentEvent } from '@/lib/agent-events'
import { buildRecipientGroup, formatRecipientListForLog } from '@/lib/outreach-recipients'
import { upsertLeadIntoGtmGraph, recordGtmTouchpoint } from '@/lib/gtm/graph'
import { bodyPreview } from '@/lib/gtm/identity'
import { recordGtmMemory } from '@/lib/gtm/memory'
import { evaluateOutboundPolicy } from '@/lib/policies/outbound'
import { persistLeadRecipientVerification, validateOutboundRecipients } from '@/lib/outbound-recipient-validation'
import {
  finishWorkflowRun,
  finishWorkflowStep,
  recordToolCall,
  startWorkflowRun,
  startWorkflowStep,
} from '@/lib/workflows/runtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const FOLLOWUP_BATCH_LIMIT = 50
const FOLLOWUP_CLAIM_STALE_MS = 15 * 60 * 1000

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const runId = await startCronRun(supabase, 'send_followups')
  try {
    const nowIso = new Date().toISOString()
    const claimToken = crypto.randomUUID()
    const staleBeforeIso = new Date(Date.now() - FOLLOWUP_CLAIM_STALE_MS).toISOString()

    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_due_followups', {
      p_limit: FOLLOWUP_BATCH_LIMIT,
      p_claim_token: claimToken,
      p_now: nowIso,
      p_stale_before: staleBeforeIso,
    })

    if (claimError) {
      throw new Error(claimError.message)
    }

    const claimedIds = ((claimedRows ?? []) as Array<{ id: string | null }>)
      .map(row => row.id)
      .filter((id): id is string => Boolean(id))
    const pendingResult = claimedIds.length > 0
      ? await supabase
          .from('scheduled_followups')
          .select(`
            id, user_id, lead_id, scheduled_for,
            leads(id, user_id, target_company, company_domain, relevance_reason, contact_email, contact_name, contact_title, contact_verified, status, is_unlocked, message_id, from_email, gmail_thread_id, client_id, origin, source_kind, relevance_score, feed_snapshot, created_at),
            outreach_sequences(followup_subject, followup_body)
          `)
          .in('id', claimedIds)
      : { data: [], error: null }

    if (pendingResult.error) {
      throw new Error(pendingResult.error.message)
    }
    const pending = pendingResult.data ?? []

    if (!pending.length) {
      const payload = { sent: 0, pending: 0 }
      await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
      return NextResponse.json(payload)
    }

    const userIds = [...new Set(pending.map(p => p.user_id))]
    const clientIds = pending
      .map(item => ((item.leads as { client_id?: string | null } | null)?.client_id ?? null))
      .filter((id): id is string => Boolean(id))
    const [profilesRes, policiesRes, clientProfilesRes] = await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id, company_name, services_description, calendly_url')
        .in('user_id', userIds),
      supabase
        .from('auto_send_policies')
        .select('user_id, client_id, enabled, connected_account_id, target_origins, require_verified_contact, min_relevance_score, max_lead_age_days')
        .in('user_id', userIds),
      clientIds.length > 0
        ? await supabase
            .from('client_accounts')
            .select('id, name, services_description, calendly_url')
            .in('id', clientIds)
        : { data: [] },
    ])

    const profiles = profilesRes.data
    const clientProfiles = clientProfilesRes.data

    const profileMap: Record<string, {
      profile: { company_name?: string | null; services_description?: string | null; calendly_url?: string | null }
    }> = {}
    for (const p of (profiles ?? [])) {
      profileMap[p.user_id] = {
        profile: {
          company_name: (p as { company_name?: string | null }).company_name ?? null,
          services_description: (p as { services_description?: string | null }).services_description ?? null,
          calendly_url: (p as { calendly_url?: string | null }).calendly_url ?? null,
        },
      }
    }
    const policyMap = new Map<string, ReturnType<typeof normalizeAutoSendPolicy>>()
    for (const row of (policiesRes.data ?? [])) {
      const normalized = normalizeAutoSendPolicy(row)
      policyMap.set(
        policyKey(
          row.user_id as string,
          (row as { client_id?: string | null }).client_id ?? null,
        ),
        normalized,
      )
    }
    const clientProfileMap = new Map(
      (clientProfiles ?? []).map(profile => [
        profile.id,
        {
          name: profile.name,
          services_description: profile.services_description,
          calendly_url: (profile as { calendly_url?: string | null }).calendly_url ?? null,
        },
      ]),
    )

    let sent = 0
    for (const item of pending) {
      const profileRecord = profileMap[item.user_id]
      if (!profileRecord) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      const lead = item.leads as unknown as {
        contact_email?: string; target_company: string; status?: string
        message_id?: string | null; from_email?: string | null; gmail_thread_id?: string | null
        company_domain?: string | null
        relevance_reason?: string | null
        contact_name?: string | null
        contact_title?: string | null
        client_id?: string | null
        origin?: 'live' | 'explore' | 'crm_import' | null
        source_kind?: string | null
        relevance_score?: number | null
        contact_verified?: boolean | null
        is_unlocked?: boolean | null
        feed_snapshot?: unknown
        created_at?: string | null
      } | null
      const seq = item.outreach_sequences as unknown as {
        followup_subject: string; followup_body: string
      } | null

      if (!lead?.contact_email) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }

      const policy = policyMap.get(policyKey(item.user_id, lead.client_id ?? null))
      if (!policy?.enabled) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      if (!policy.target_origins.includes((lead.origin ?? 'live') as 'live' | 'explore' | 'crm_import')) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      if ((lead.relevance_score ?? 0) < policy.min_relevance_score) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      if (policy.require_verified_contact && lead.contact_verified !== true) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }
      if (lead.created_at) {
        const ageMs = Date.now() - new Date(lead.created_at).getTime()
        if (ageMs > policy.max_lead_age_days * 24 * 60 * 60 * 1000) {
          await releaseClaim(supabase, item.id, claimToken)
          continue
        }
      }

    // Fall back to a generic follow-up template when pre-generation didn't complete
      const fuSubject = seq?.followup_subject ?? `Following up`
      const fuBody    = seq?.followup_body    ??
        `Probably caught you at a bad time — figured I'd check back in case it's still relevant.\n\nWorth a quick 15-min call this week?`

      if (lead.status === 'replied' || lead.status === 'booked') {
        await completeFollowup(supabase, item.id, claimToken, nowIso)
        continue
      }

      const { data: draftForRecipients } = await supabase
        .from('outreach_drafts')
        .select('stakeholders')
        .eq('lead_id', item.lead_id)
        .maybeSingle()
      const draftStakeholders = Array.isArray((draftForRecipients as { stakeholders?: unknown } | null)?.stakeholders)
        ? (draftForRecipients as { stakeholders: Array<{ name?: string; title?: string; email?: string }> }).stakeholders
        : []
      const recipientGroup = buildRecipientGroup(draftStakeholders.length > 0
        ? draftStakeholders
        : [{ email: lead.contact_email }]
      )
      if (!recipientGroup) {
        await releaseClaim(supabase, item.id, claimToken)
        continue
      }

      const emails = recipientGroup.all.map(recipient => recipient.email.toLowerCase())
      const workflowRunId = await startWorkflowRun(supabase, {
        userId: item.user_id,
        clientId: lead.client_id ?? null,
        workflowType: 'scheduled_followup_send',
        workflowKey: item.id,
        idempotencyKey: `scheduled_followup:${item.id}:${claimToken}`,
        input: {
          scheduled_followup_id: item.id,
          lead_id: item.lead_id,
          recipient_count: emails.length,
        },
      })
      const graphStepId = await startWorkflowStep(supabase, {
        runId: workflowRunId,
        userId: item.user_id,
        clientId: lead.client_id ?? null,
        stepKey: 'graph_sync',
        input: { lead_id: item.lead_id },
      })
      const graph = await upsertLeadIntoGtmGraph(supabase, {
        id: item.lead_id,
        user_id: item.user_id,
        client_id: lead.client_id ?? null,
        target_company: lead.target_company,
        company_domain: lead.company_domain ?? null,
        relevance_score: lead.relevance_score ?? null,
        relevance_reason: lead.relevance_reason ?? null,
        status: lead.status ?? null,
        is_unlocked: lead.is_unlocked ?? true,
        contact_email: lead.contact_email ?? null,
        contact_name: lead.contact_name ?? null,
        contact_title: lead.contact_title ?? null,
        contact_verified: lead.contact_verified ?? null,
        origin: lead.origin ?? null,
        source_kind: lead.source_kind ?? null,
        feed_snapshot: lead.feed_snapshot,
        created_at: lead.created_at ?? null,
      }, { workflowRunId })
      await finishWorkflowStep(supabase, {
        stepId: graphStepId,
        status: graph ? 'completed' : 'skipped',
        output: graph ? {
          account_id: graph.accountId,
          person_id: graph.personId,
          signal_id: graph.signalId,
        } : {},
      })
      const validationStepId = await startWorkflowStep(supabase, {
        runId: workflowRunId,
        userId: item.user_id,
        clientId: lead.client_id ?? null,
        stepKey: 'recipient_validation',
        input: { lead_id: item.lead_id, recipient_count: emails.length },
      })
      const recipientValidation = await validateOutboundRecipients(emails)
      const leadContactVerified = await persistLeadRecipientVerification(supabase, {
        leadId: item.lead_id,
        userId: item.user_id,
        primaryEmail: recipientGroup.to.email,
        validation: recipientValidation,
      })
      await finishWorkflowStep(supabase, {
        stepId: validationStepId,
        status: recipientValidation.safe ? 'completed' : 'blocked',
        output: {
          safe: recipientValidation.safe,
          unsafe_emails: recipientValidation.unsafeEmails,
          statuses: recipientValidation.rows,
        },
      })
      if (!recipientValidation.safe) {
        const reasons = recipientValidation.reasons.length ? recipientValidation.reasons : ['recipient_not_verified']
        await recordAgentEvent(supabase, {
          userId: item.user_id,
          clientId: lead.client_id ?? null,
          leadId: item.lead_id,
          agentName: 'safety',
          eventType: 'recipient_validation_blocked',
          status: 'blocked',
          title: 'Follow-up blocked by recipient validation',
          body: `Unsafe recipient(s): ${recipientValidation.unsafeEmails.join(', ')}.`,
          metadata: { reasons, unsafe_emails: recipientValidation.unsafeEmails },
        })
        if (graph) {
          await recordGtmTouchpoint(supabase, {
            userId: item.user_id,
            clientId: lead.client_id ?? null,
            accountId: graph.accountId,
            personId: graph.personId,
            leadId: item.lead_id,
            workflowRunId,
            type: 'followup',
            status: 'blocked',
            subject: fuSubject,
            bodyPreview: bodyPreview(fuBody),
            toEmail: recipientGroup.to.email,
            metadata: { reasons, recipient_validation: recipientValidation.rows },
          })
        }
        await completeFollowup(supabase, item.id, claimToken, nowIso)
        await finishWorkflowRun(supabase, {
          runId: workflowRunId,
          status: 'completed',
          output: { sent: false, blocked_at: 'recipient_validation', reasons, unsafe_emails: recipientValidation.unsafeEmails },
          checkpoint: { blocked_at: 'recipient_validation' },
        })
        continue
      }
      const policyStepId = await startWorkflowStep(supabase, {
        runId: workflowRunId,
        userId: item.user_id,
        clientId: lead.client_id ?? null,
        stepKey: 'policy',
        input: { lead_id: item.lead_id, recipient_count: emails.length },
      })
      const policyDecision = await evaluateOutboundPolicy(supabase, {
        userId: item.user_id,
        clientId: lead.client_id ?? null,
        leadId: item.lead_id,
        targetCompany: lead.target_company,
        companyDomain: lead.company_domain ?? null,
        status: lead.status ?? null,
        isUnlocked: lead.is_unlocked ?? true,
        contactVerified: leadContactVerified,
        recipientValidationSafe: recipientValidation.safe && leadContactVerified,
        recipientEmails: emails,
        requireVerifiedContact: policy.require_verified_contact,
        runId: workflowRunId,
        stepId: policyStepId,
      })
      await finishWorkflowStep(supabase, {
        stepId: policyStepId,
        status: policyDecision.decision === 'allowed' ? 'completed' : 'blocked',
        output: {
          decision: policyDecision.decision,
          reasons: policyDecision.reasons,
        },
      })
      if (policyDecision.decision !== 'allowed') {
        if (graph) {
          await recordGtmTouchpoint(supabase, {
            userId: item.user_id,
            clientId: lead.client_id ?? null,
            accountId: graph.accountId,
            personId: graph.personId,
            leadId: item.lead_id,
            workflowRunId,
            type: 'followup',
            status: 'blocked',
            subject: fuSubject,
            bodyPreview: bodyPreview(fuBody),
            toEmail: recipientGroup.to.email,
            metadata: { reasons: policyDecision.reasons },
          })
        }
        await completeFollowup(supabase, item.id, claimToken, nowIso)
        await finishWorkflowRun(supabase, {
          runId: workflowRunId,
          status: 'completed',
          output: { sent: false, policy_decision: policyDecision.decision, reasons: policyDecision.reasons },
          checkpoint: { blocked_at: 'policy' },
        })
        continue
      }

    // For Gmail threads, pass threadId for proper threading.
    // For Outlook, gmail_thread_id stores the conversationId — not directly usable as inReplyTo,
    // but the outlook webhook will handle reply detection via conversationId.
      const gmailThreadId = lead.gmail_thread_id ?? null
      const inReplyTo     = messageIdHeader(lead.message_id)
      const clientProfile = lead.client_id ? clientProfileMap.get(lead.client_id) ?? null : null
      const outreachContext = resolveOutreachContext({
        userProfile: profileRecord.profile,
        clientProfile,
      })

      try {
        const sendStepId = await startWorkflowStep(supabase, {
          runId: workflowRunId,
          userId: item.user_id,
          clientId: lead.client_id ?? null,
          stepKey: 'send',
          input: { lead_id: item.lead_id, recipient_count: emails.length },
        })
        await recordToolCall(supabase, {
          runId: workflowRunId,
          stepId: sendStepId,
          userId: item.user_id,
          clientId: lead.client_id ?? null,
          toolName: 'sendWithConnectedAccount',
          status: 'running',
          toolInput: {
            to: recipientGroup.to.email,
            cc_count: recipientGroup.cc.length,
            prefer_email: lead.from_email ?? null,
            prefer_account_id: lead.from_email ? null : policy.connected_account_id,
          },
        })
        const result = await sendWithConnectedAccount({
          userId:        item.user_id,
          supabase,
          to:            recipientGroup.to.email,
          cc:            recipientGroup.cc.map(recipient => recipient.email),
          subject:       fuSubject,
          body:          fuBody,
          fromName:      outreachContext.fromName,
          inReplyTo,
          gmailThreadId,
          preferEmail:   lead.from_email ?? null,
          preferAccountId: lead.from_email ? null : policy.connected_account_id,
        })

        if (!result) {
          await releaseClaim(supabase, item.id, claimToken)
          await finishWorkflowStep(supabase, {
            stepId: sendStepId,
            status: 'blocked',
            output: { reason: 'no_eligible_inbox' },
          })
          await finishWorkflowRun(supabase, {
            runId: workflowRunId,
            status: 'completed',
            output: { sent: false, reason: 'no_eligible_inbox' },
            checkpoint: { blocked_at: 'send' },
          })
          continue
        }
        await recordToolCall(supabase, {
          runId: workflowRunId,
          stepId: sendStepId,
          userId: item.user_id,
          clientId: lead.client_id ?? null,
          toolName: 'sendWithConnectedAccount',
          status: 'completed',
          output: {
            provider: result.provider,
            from_email: result.fromEmail,
            message_id: result.messageId,
          },
        })

        await completeFollowup(supabase, item.id, claimToken, nowIso)
        if (result.messageId) {
          await supabase.from('leads').update({
            message_id:      result.messageId,
            gmail_thread_id: result.threadId ?? lead.gmail_thread_id,
          }).eq('id', item.lead_id)
        }
        await recordAgentEvent(supabase, {
          userId: item.user_id,
          clientId: lead.client_id ?? null,
          leadId: item.lead_id,
          agentName: 'followup',
          eventType: 'followup_sent',
          status: 'completed',
          title: `Sent follow-up to ${lead.target_company}`,
          body: `Follow-up sent from ${result.fromEmail} to ${formatRecipientListForLog(recipientGroup)}.`,
          metadata: {
            provider: result.provider,
            message_id: result.messageId,
            thread_id: result.threadId,
            to: recipientGroup.to.email,
            cc: recipientGroup.cc.map(recipient => recipient.email),
          },
        })
        if (graph) {
          await recordGtmTouchpoint(supabase, {
            userId: item.user_id,
            clientId: lead.client_id ?? null,
            accountId: graph.accountId,
            personId: graph.personId,
            leadId: item.lead_id,
            workflowRunId,
            type: 'followup',
            status: 'sent',
            subject: fuSubject,
            bodyPreview: bodyPreview(fuBody),
            fromEmail: result.fromEmail,
            toEmail: recipientGroup.to.email,
            provider: result.provider,
            messageId: result.messageId,
            occurredAt: nowIso,
            metadata: {
              cc: recipientGroup.cc.map(recipient => recipient.email),
              thread_id: result.threadId,
            },
          })
          await recordGtmMemory(supabase, {
            userId: item.user_id,
            clientId: lead.client_id ?? null,
            scope: 'entity',
            entityType: 'account',
            entityId: graph.accountId,
            memoryType: 'followup_sent',
            content: `Sent follow-up from ${result.fromEmail} to ${formatRecipientListForLog(recipientGroup)} about "${fuSubject}".`,
            source: 'scheduled_followup',
            confidence: 1,
            observedAt: nowIso,
            provenance: {
              lead_id: item.lead_id,
              scheduled_followup_id: item.id,
              message_id: result.messageId,
              provider: result.provider,
            },
            workflowRunId,
          })
        }
        await finishWorkflowStep(supabase, {
          stepId: sendStepId,
          status: 'completed',
          output: {
            from_email: result.fromEmail,
            provider: result.provider,
            message_id: result.messageId,
          },
        })
        await finishWorkflowRun(supabase, {
          runId: workflowRunId,
          status: 'completed',
          output: { sent: true, message_id: result.messageId, from_email: result.fromEmail },
          checkpoint: { completed_at: nowIso, lead_id: item.lead_id },
        })
        sent++
      } catch (err) {
        console.error(`[send-followups] failed for lead ${item.lead_id}:`, err)
        await releaseClaim(supabase, item.id, claimToken)
        await finishWorkflowRun(supabase, {
          runId: workflowRunId,
          status: 'failed',
          output: { sent: false },
          errorMessage: err instanceof Error ? err.message : 'Failed to send follow-up',
          checkpoint: { failed_at: new Date().toISOString(), lead_id: item.lead_id },
        })
      }
    }

    const payload = { sent, pending: pending.length }
    await finishCronRun(supabase, runId, { status: 'success', metrics: payload })
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    await finishCronRun(supabase, runId, { status: 'error', errorMessage: message })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function completeFollowup(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  followupId: string,
  claimToken: string,
  sentAt: string,
) {
  await supabase
    .from('scheduled_followups')
    .update({
      sent_at: sentAt,
      processing_started_at: null,
      processing_token: null,
    })
    .eq('id', followupId)
    .eq('processing_token', claimToken)
}

async function releaseClaim(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  followupId: string,
  claimToken: string,
) {
  await supabase
    .from('scheduled_followups')
    .update({
      processing_started_at: null,
      processing_token: null,
    })
    .eq('id', followupId)
    .eq('processing_token', claimToken)
    .is('sent_at', null)
}
