import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { draftFollowUpEmail } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { resolveOutreachContext, scheduleFollowupAt } from '@/lib/outreach-context'
import { recordAgentEvent } from '@/lib/agent-events'
import { buildRecipientGroup, ensureBodyGreetsRecipients, formatRecipientListForLog } from '@/lib/outreach-recipients'
import { upsertLeadIntoGtmGraph, recordGtmTouchpoint } from '@/lib/gtm/graph'
import { bodyPreview } from '@/lib/gtm/identity'
import { recordGtmMemory } from '@/lib/gtm/memory'
import { buildOutreachPlan } from '@/lib/gtm/outreach-plan'
import { markLatestOutreachPlanStatus, persistOutreachPlan } from '@/lib/gtm/outreach-plan-store'
import { recordOutcomeLearning } from '@/lib/gtm/outcome-learning'
import { evaluateOutboundPolicy } from '@/lib/policies/outbound'
import { persistLeadRecipientVerification, validateOutboundRecipients } from '@/lib/outbound-recipient-validation'
import {
  finishWorkflowRun,
  finishWorkflowStep,
  recordToolCall,
  startWorkflowRun,
  startWorkflowStep,
} from '@/lib/workflows/runtime'

export async function POST(request: Request) {
  const userSupabase = await createClient()
  const { data: { user } } = await userSupabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = await createServiceClient()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (
    typeof body !== 'object' || body === null ||
    !('leadId' in body) || !('to' in body) ||
    !('subject' in body) || !('body' in body)
  ) {
    return NextResponse.json({ error: 'leadId, to, subject, and body are required' }, { status: 400 })
  }

  const { leadId, to, cc, subject, body: emailBody, isFollowUp } = body as {
    leadId: string; to: string; cc?: string[]; subject: string; body: string; isFollowUp?: boolean
  }

  if (!leadId || !to || !subject || !emailBody) {
    return NextResponse.json({ error: 'leadId, to, subject, and body must be non-empty' }, { status: 400 })
  }
  if (subject.length > 998 || emailBody.length > 100_000) {
    return NextResponse.json({ error: 'Subject or body exceeds maximum length' }, { status: 400 })
  }

  const [leadRes, profileRes] = await Promise.all([
    supabase.from('leads').select('id, user_id, client_id, origin, source_kind, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, contact_email, contact_name, contact_title, contact_verified, contact_verified_at, contact_verification_status, feed_snapshot, created_at').eq('id', leadId).eq('user_id', user.id).single(),
    supabase.from('user_profiles').select('company_name, services_description, calendly_url').eq('user_id', user.id).single(),
  ])

  if (!leadRes.data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!leadRes.data.is_unlocked) {
    return NextResponse.json({ error: 'Unlock this lead first before sending outreach.' }, { status: 403 })
  }

  const rl = await checkRateLimit(`send:${user.id}`, 5, 3600, { failClosed: true })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many sends. Limit is 5 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const recipientGroup = buildRecipientGroup([
    { email: to },
    ...(Array.isArray(cc) ? cc.map(email => ({ email })) : []),
  ])
  if (!recipientGroup) return NextResponse.json({ error: 'At least one valid recipient is required.' }, { status: 400 })
  const normalizedEmailBody = ensureBodyGreetsRecipients(emailBody, recipientGroup.greeting)

  const clientId = (leadRes.data as { client_id?: string | null }).client_id ?? null
  const workflowRunId = await startWorkflowRun(supabase, {
    userId: user.id,
    clientId,
    workflowType: isFollowUp ? 'manual_followup_send' : 'manual_outreach_send',
    workflowKey: leadId,
    idempotencyKey: `manual_send:${leadId}:${Date.now()}`,
    input: {
      lead_id: leadId,
      is_follow_up: isFollowUp === true,
      subject,
    },
  })
  const graphStepId = await startWorkflowStep(supabase, {
    runId: workflowRunId,
    userId: user.id,
    clientId,
    stepKey: 'graph_sync',
    input: { lead_id: leadId },
  })
  const graph = await upsertLeadIntoGtmGraph(supabase, leadRes.data, { workflowRunId })
  await finishWorkflowStep(supabase, {
    stepId: graphStepId,
    status: graph ? 'completed' : 'skipped',
    output: graph ? {
      account_id: graph.accountId,
      person_id: graph.personId,
      signal_id: graph.signalId,
    } : {},
  })

  const { data: clientProfileForPlan } = clientId
    ? await supabase
        .from('client_accounts')
        .select('name, services_description, calendly_url')
        .eq('id', clientId)
        .eq('user_id', user.id)
        .maybeSingle()
    : { data: null }
  const outreachPlan = buildOutreachPlan({
    lead: leadRes.data,
    mode: 'manual',
    senderContext: {
      companyName: (clientProfileForPlan as { name?: string | null } | null)?.name ?? (profileRes.data as { company_name?: string | null } | null)?.company_name ?? null,
      servicesDescription: (clientProfileForPlan as { services_description?: string | null } | null)?.services_description ?? (profileRes.data as { services_description?: string | null } | null)?.services_description ?? null,
    },
  })
  const planStepId = await startWorkflowStep(supabase, {
    runId: workflowRunId,
    userId: user.id,
    clientId,
    stepKey: 'outreach_plan',
    input: { lead_id: leadId, mode: 'manual' },
  })
  if (graph) {
    await persistOutreachPlan(supabase, {
      userId: user.id,
      clientId,
      leadId,
      accountId: graph.accountId,
      personId: graph.personId,
      plan: outreachPlan,
      workflowRunId,
    })
    await recordGtmMemory(supabase, {
      userId: user.id,
      clientId,
      scope: 'entity',
      entityType: 'account',
      entityId: graph.accountId,
      memoryType: 'outreach_plan',
      content: `${outreachPlan.trigger}. ${outreachPlan.angle}`,
      source: 'manual_outreach_planner',
      confidence: outreachPlan.confidence / 100,
      observedAt: new Date().toISOString(),
      provenance: { lead_id: leadId, outreach_plan: outreachPlan },
      workflowRunId,
    })
  }
  await finishWorkflowStep(supabase, {
    stepId: planStepId,
    status: 'completed',
    output: { outreach_plan: outreachPlan },
  })

  const recipientEmails = recipientGroup.all.map(recipient => recipient.email.toLowerCase())
  const validationStepId = await startWorkflowStep(supabase, {
    runId: workflowRunId,
    userId: user.id,
    clientId,
    stepKey: 'recipient_validation',
    input: { lead_id: leadId, recipient_count: recipientEmails.length },
  })
  const recipientValidation = await validateOutboundRecipients(recipientEmails)
  const leadContactVerified = await persistLeadRecipientVerification(supabase, {
    leadId,
    userId: user.id,
    primaryEmail: recipientGroup.to.email,
    validation: recipientValidation,
  })
  await finishWorkflowStep(supabase, {
    stepId: validationStepId,
    status: recipientValidation.safe ? 'completed' : 'blocked',
    output: {
      safe: recipientValidation.safe,
      unsafe_emails: recipientValidation.unsafeEmails,
      statuses: recipientValidation.rows.map(row => ({
        email: row.email,
        status: row.status,
        safe: row.safe,
        reason: row.reason,
      })),
    },
  })

  if (!recipientValidation.safe) {
    const reasons = recipientValidation.reasons.length ? recipientValidation.reasons : ['recipient_not_verified']
    await recordAgentEvent(supabase, {
      userId: user.id,
      clientId,
      leadId,
      agentName: 'safety',
      eventType: 'recipient_validation_blocked',
      status: 'blocked',
      title: 'Send blocked by recipient validation',
      body: `Unsafe recipient(s): ${recipientValidation.unsafeEmails.join(', ')}.`,
      metadata: { reasons, recipient_validation: recipientValidation.rows, outreach_plan: outreachPlan },
    })
    if (graph) {
      await recordGtmTouchpoint(supabase, {
        userId: user.id,
        clientId,
        accountId: graph.accountId,
        personId: graph.personId,
        leadId,
        workflowRunId,
        type: isFollowUp ? 'followup' : 'email',
        status: 'blocked',
        subject,
        bodyPreview: bodyPreview(normalizedEmailBody),
        toEmail: recipientGroup.to.email,
        metadata: { reasons, recipient_validation: recipientValidation.rows, outreach_plan: outreachPlan },
      })
    }
    await markLatestOutreachPlanStatus(supabase, {
      userId: user.id,
      leadId,
      status: 'blocked',
    })
    await finishWorkflowRun(supabase, {
      runId: workflowRunId,
      status: 'completed',
      output: {
        sent: false,
        blocked_at: 'recipient_validation',
        reasons,
        unsafe_emails: recipientValidation.unsafeEmails,
      },
      checkpoint: { blocked_at: 'recipient_validation' },
    })
    return NextResponse.json({
      error: `Send blocked: recipient validation failed for ${recipientValidation.unsafeEmails.join(', ')}`,
      reasons,
    }, { status: 422 })
  }

  const policyStepId = await startWorkflowStep(supabase, {
    runId: workflowRunId,
    userId: user.id,
    clientId,
    stepKey: 'policy',
    input: { lead_id: leadId, recipient_count: recipientEmails.length },
  })
  const policyDecision = await evaluateOutboundPolicy(supabase, {
    userId: user.id,
    clientId,
    leadId,
    targetCompany: leadRes.data.target_company,
    companyDomain: (leadRes.data as { company_domain?: string | null }).company_domain ?? null,
    status: leadRes.data.status,
    isUnlocked: leadRes.data.is_unlocked,
    contactVerified: leadContactVerified,
    recipientValidationSafe: recipientValidation.safe && leadContactVerified,
    recipientEmails,
    requireVerifiedContact: true,
    runId: workflowRunId,
    stepId: policyStepId,
    metadata: { outreach_plan: outreachPlan },
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
    await recordAgentEvent(supabase, {
      userId: user.id,
      clientId,
      leadId,
      agentName: 'safety',
      eventType: 'outbound_policy_blocked',
      status: 'blocked',
      title: 'Send blocked by outbound policy',
      body: `Blocked by ${policyDecision.reasons.join(', ')}.`,
      metadata: { reasons: policyDecision.reasons, recipients: recipientEmails, outreach_plan: outreachPlan },
    })
    if (graph) {
      await recordGtmTouchpoint(supabase, {
        userId: user.id,
        clientId,
        accountId: graph.accountId,
        personId: graph.personId,
        leadId,
        workflowRunId,
        type: isFollowUp ? 'followup' : 'email',
        status: 'blocked',
        subject,
        bodyPreview: bodyPreview(normalizedEmailBody),
        toEmail: recipientGroup.to.email,
        metadata: { reasons: policyDecision.reasons, outreach_plan: outreachPlan },
      })
    }
    await markLatestOutreachPlanStatus(supabase, {
      userId: user.id,
      leadId,
      status: 'blocked',
    })
    await finishWorkflowRun(supabase, {
      runId: workflowRunId,
      status: 'completed',
      output: { sent: false, policy_decision: policyDecision.decision, reasons: policyDecision.reasons },
      checkpoint: { blocked_at: 'policy' },
    })
    return NextResponse.json({ error: `Send blocked: ${policyDecision.reasons.join(', ')}` }, { status: 422 })
  }

  try {
    const { data: clientProfile } = clientId
      ? await supabase
          .from('client_accounts')
          .select('name, services_description, calendly_url')
          .eq('id', clientId)
          .eq('user_id', user.id)
          .maybeSingle()
      : { data: null }
    const outreachContext = resolveOutreachContext({
      userProfile: profileRes.data,
      clientProfile,
    })

    const sendStepId = await startWorkflowStep(supabase, {
      runId: workflowRunId,
      userId: user.id,
      clientId,
      stepKey: 'send',
      input: {
        lead_id: leadId,
        recipient_count: recipientEmails.length,
      },
    })
    await recordToolCall(supabase, {
      runId: workflowRunId,
      stepId: sendStepId,
      userId: user.id,
      clientId,
      toolName: 'sendWithConnectedAccount',
      status: 'running',
      toolInput: {
        to: recipientGroup.to.email,
        cc_count: recipientGroup.cc.length,
      },
    })
    const result = await sendWithConnectedAccount({
      userId:   user.id,
      supabase,
      to:       recipientGroup.to.email,
      cc:       recipientGroup.cc.map(recipient => recipient.email),
      subject,
      body:     normalizedEmailBody,
      fromName: outreachContext.fromName,
    })

    if (!result) {
      await recordAgentEvent(supabase, {
        userId: user.id,
        clientId: (leadRes.data as { client_id?: string | null }).client_id ?? null,
        leadId,
        agentName: 'safety',
        eventType: 'send_blocked',
        status: 'blocked',
        title: 'Send blocked: no connected inbox',
        body: 'Connect a sending inbox before sending outreach.',
      })
      await finishWorkflowStep(supabase, {
        stepId: sendStepId,
        status: 'blocked',
        output: { reason: 'no_connected_inbox' },
      })
      await finishWorkflowRun(supabase, {
        runId: workflowRunId,
        status: 'completed',
        output: { sent: false, reason: 'no_connected_inbox' },
        checkpoint: { blocked_at: 'send' },
      })
      await markLatestOutreachPlanStatus(supabase, {
        userId: user.id,
        leadId,
        status: 'blocked',
      })
      return NextResponse.json(
        { error: 'No sending account connected. Go to Settings → Sending Accounts to connect an inbox.' },
        { status: 503 }
      )
    }
    await recordToolCall(supabase, {
      runId: workflowRunId,
      stepId: sendStepId,
      userId: user.id,
      clientId,
      toolName: 'sendWithConnectedAccount',
      status: 'completed',
      output: {
        provider: result.provider,
        from_email: result.fromEmail,
        message_id: result.messageId,
      },
    })

    const now = new Date().toISOString()
    await supabase.from('leads').update({
      status:          'sent',
      sent_at:         now,
      message_id:      result.messageId,
      from_email:      result.fromEmail,
      gmail_thread_id: result.threadId,
    }).eq('id', leadId)

    emitCrmLeadEvent({
      userId: user.id,
      clientId: (leadRes.data as { client_id?: string | null }).client_id ?? null,
      eventType: 'lead.sent',
      payload: {
        lead_id: leadId,
        target_company: (leadRes.data as { target_company?: string }).target_company ?? '',
        from_email: result.fromEmail,
        message_id: result.messageId,
      },
    }).catch(() => {})

    if (!isFollowUp) {
      const followAt = scheduleFollowupAt()
      await supabase.from('scheduled_followups').upsert(
        { user_id: user.id, lead_id: leadId, scheduled_for: followAt },
        { onConflict: 'lead_id' }
      )
      // Pre-generate follow-up copy fire-and-forget — never blocks the send response
      pregenerateFollowup(supabase, leadId, profileRes.data, clientProfile).catch(err =>
        console.error('[outreach/send] follow-up pre-generation failed:', err)
      )
    }

    await recordAgentEvent(supabase, {
      userId: user.id,
      clientId: (leadRes.data as { client_id?: string | null }).client_id ?? null,
      leadId,
      agentName: isFollowUp ? 'followup' : 'sending',
      eventType: isFollowUp ? 'followup_sent' : 'email_sent',
      status: 'completed',
      title: `${isFollowUp ? 'Sent follow-up' : 'Sent outreach'} to ${(leadRes.data as { target_company?: string }).target_company ?? 'lead'}`,
      body: `Sent from ${result.fromEmail} to ${formatRecipientListForLog(recipientGroup)}.`,
      metadata: {
        provider: result.provider,
        message_id: result.messageId,
        thread_id: result.threadId,
        to: recipientGroup.to.email,
          cc: recipientGroup.cc.map(recipient => recipient.email),
          outreach_plan: outreachPlan,
        },
      })

    if (graph) {
      await recordGtmTouchpoint(supabase, {
        userId: user.id,
        clientId,
        accountId: graph.accountId,
        personId: graph.personId,
        leadId,
        workflowRunId,
        type: isFollowUp ? 'followup' : 'email',
        status: 'sent',
        subject,
        bodyPreview: bodyPreview(normalizedEmailBody),
        fromEmail: result.fromEmail,
        toEmail: recipientGroup.to.email,
        provider: result.provider,
        messageId: result.messageId,
        occurredAt: now,
        metadata: {
          cc: recipientGroup.cc.map(recipient => recipient.email),
          thread_id: result.threadId,
          manual: true,
          outreach_plan: outreachPlan,
        },
      })
      await recordGtmMemory(supabase, {
        userId: user.id,
        clientId,
        scope: 'entity',
        entityType: 'account',
        entityId: graph.accountId,
        memoryType: isFollowUp ? 'manual_followup_sent' : 'manual_outreach_sent',
        content: `Manually sent ${isFollowUp ? 'follow-up' : 'outreach'} from ${result.fromEmail} to ${formatRecipientListForLog(recipientGroup)} about "${subject}".`,
        source: 'manual_outreach_send',
        confidence: 1,
        observedAt: now,
        provenance: {
          lead_id: leadId,
          message_id: result.messageId,
          provider: result.provider,
          outreach_plan: outreachPlan,
        },
        workflowRunId,
      })
    }
    await recordOutcomeLearning(supabase, {
      userId: user.id,
      clientId,
      leadId,
      outcome: 'sent',
      observedAt: now,
      metadata: {
        provider: result.provider,
        from_email: result.fromEmail,
        manual: true,
        outreach_plan_confidence: outreachPlan.confidence,
      },
      workflowRunId,
    })
    await markLatestOutreachPlanStatus(supabase, {
      userId: user.id,
      leadId,
      status: 'sent',
    })
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
      checkpoint: { completed_at: now, lead_id: leadId, outreach_plan_confidence: outreachPlan.confidence },
    })

    return NextResponse.json({ success: true, messageId: result.messageId, fromEmail: result.fromEmail })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    console.error('[outreach/send]', message)
    await finishWorkflowRun(supabase, {
      runId: workflowRunId,
      status: 'failed',
      output: { sent: false },
      errorMessage: message,
      checkpoint: { failed_at: new Date().toISOString() },
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function pregenerateFollowup(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  leadId: string,
  profile: { company_name: string; services_description: string; calendly_url?: string | null } | null,
  clientProfile: { name?: string | null; services_description?: string | null; calendly_url?: string | null } | null,
) {
  const { data: existingSeq } = await supabase
    .from('outreach_sequences').select('id').eq('lead_id', leadId).maybeSingle()
  if (existingSeq) return

  const [draftRes, leadSigRes] = await Promise.all([
    supabase.from('outreach_drafts').select('subject, body, stakeholders').eq('lead_id', leadId).single(),
    supabase.from('leads').select('target_company, relevance_reason, feed_snapshot').eq('id', leadId).single(),
  ])
  if (!draftRes.data || !leadSigRes.data) return

  const signal = normalizeLeadFeedSnapshot((leadSigRes.data as { feed_snapshot?: unknown }).feed_snapshot ?? null)
  const stks   = Array.isArray(draftRes.data.stakeholders)
    ? (draftRes.data.stakeholders as Array<{ name?: string }>)
    : []

  const outreachContext = resolveOutreachContext({
    userProfile: profile,
    clientProfile,
  })

  const { subject: fuSubject, body: fuBody } = await draftFollowUpEmail({
    senderCompany:       outreachContext.senderCompany,
    servicesDescription: outreachContext.servicesDescription,
    stakeholderName:     stks[0]?.name || 'there',
    targetCompany:       leadSigRes.data.target_company,
    signalType:          signal?.signal_type || 'event',
    signalSummary:       signal?.summary || leadSigRes.data.relevance_reason || '',
    originalSubject:     draftRes.data.subject,
    originalBody:        draftRes.data.body,
  })

  await supabase.from('outreach_sequences').upsert(
    { lead_id: leadId, followup_subject: fuSubject, followup_body: fuBody },
    { onConflict: 'lead_id' }
  )
}
