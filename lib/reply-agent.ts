import type { SupabaseClient } from '@supabase/supabase-js'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { recordAgentEvent } from '@/lib/agent-events'
import { normalizeEmailAddress } from '@/lib/email-safety'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { sendReplyOutcomeEmail } from '@/lib/resend'
import {
  buildBookingReplyBody,
  classifyReplyIntent,
  isBookedIntent,
  isPositiveIntent,
  shouldAutoSendBookingLink,
} from '@/lib/reply-intelligence'

interface LeadForReplyAgent {
  id: string
  status: string
  client_id?: string | null
  target_company?: string | null
  from_email?: string | null
  booking_reply_sent_at?: string | null
}

export interface InboundReplyMessage {
  provider: 'gmail' | 'outlook'
  from: string
  subject?: string | null
  text?: string | null
  messageId?: string | null
  threadId?: string | null
}

export async function processInboundReply(params: {
  supabase: SupabaseClient
  userId: string
  lead: LeadForReplyAgent
  accountEmail: string
  message: InboundReplyMessage
}): Promise<void> {
  const { supabase, userId, lead, accountEmail, message } = params
  const now = new Date().toISOString()
  const text = cleanReplyText(message.text ?? '')
  const intent = classifyReplyIntent({ subject: message.subject, text })
  const booked = isBookedIntent(intent)
  const nextStatus = booked ? 'booked' : 'replied'

  const [{ data: profile }, userResult] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('company_name, calendly_url, automation_mode')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.auth.admin.getUserById(userId),
  ])

  const updates: Record<string, unknown> = {
    status: nextStatus,
    replied_at: now,
    reply_received_at: now,
    reply_intent: intent.intent,
    reply_summary: intent.summary,
    reply_body_snippet: text.slice(0, 1000) || null,
  }
  if (booked) {
    updates.booked_at = now
    updates.meeting_detected_at = now
  } else if (intent.intent === 'meeting_requested') {
    updates.meeting_detected_at = now
  }

  await supabase.from('leads').update(updates).eq('id', lead.id).eq('user_id', userId)
  await stopPendingFollowups(supabase, lead.id, now)

  await recordAgentEvent(supabase, {
    userId,
    clientId: lead.client_id ?? null,
    leadId: lead.id,
    agentName: 'reply',
    eventType: 'reply_received',
    status: 'completed',
    title: `Reply received from ${lead.target_company ?? 'lead'}`,
    body: intent.summary,
    metadata: {
      provider: message.provider,
      from: message.from,
      subject: message.subject ?? null,
      intent: intent.intent,
      confidence: intent.confidence,
      thread_id: message.threadId ?? null,
    },
  })

  if (booked) {
    await recordAgentEvent(supabase, {
      userId,
      clientId: lead.client_id ?? null,
      leadId: lead.id,
      agentName: 'booking',
      eventType: 'meeting_detected',
      status: 'completed',
      title: `Meeting detected for ${lead.target_company ?? 'lead'}`,
      body: 'Bombsell marked this lead as booked based on the reply.',
      metadata: { intent: intent.intent, confidence: intent.confidence },
    })
  }

  await maybeSendBookingLink({
    supabase,
    userId,
    lead,
    accountEmail,
    profile: profile as { company_name?: string | null; calendly_url?: string | null; automation_mode?: string | null } | null,
    message,
    intent,
    now,
  })

  if (isPositiveIntent(intent) || booked) {
    const email = userResult.data.user?.email
    if (email) {
      sendReplyOutcomeEmail({
        toEmail: email,
        companyName: (profile as { company_name?: string | null } | null)?.company_name ?? 'your workspace',
        leadCompany: lead.target_company ?? 'Lead',
        intent: intent.intent,
        summary: intent.summary,
      }).catch(error => console.error('[reply-agent] outcome email failed:', error))
    }
  }

  emitCrmLeadEvent({
    userId,
    clientId: lead.client_id ?? null,
    eventType: booked ? 'lead.booked' : 'lead.replied',
    payload: {
      lead_id: lead.id,
      target_company: lead.target_company ?? '',
      reply_intent: intent.intent,
      reply_summary: intent.summary,
    },
  }).catch(() => {})
}

async function maybeSendBookingLink(params: {
  supabase: SupabaseClient
  userId: string
  lead: LeadForReplyAgent
  accountEmail: string
  profile: { company_name?: string | null; calendly_url?: string | null; automation_mode?: string | null } | null
  message: InboundReplyMessage
  intent: ReturnType<typeof classifyReplyIntent>
  now: string
}) {
  const calendlyUrl = params.profile?.calendly_url?.trim()
  if (!calendlyUrl) return
  if (params.profile?.automation_mode !== 'autopilot') return
  if (!shouldAutoSendBookingLink(params.intent)) return
  if (params.lead.booking_reply_sent_at) return

  let recipient: string
  try {
    recipient = extractEmailAddress(params.message.from)
    normalizeEmailAddress(recipient)
  } catch {
    await recordAgentEvent(params.supabase, {
      userId: params.userId,
      clientId: params.lead.client_id ?? null,
      leadId: params.lead.id,
      agentName: 'booking',
      eventType: 'booking_reply_blocked',
      status: 'blocked',
      title: 'Booking reply blocked: invalid sender address',
      body: 'Bombsell could not safely parse the reply sender address.',
    })
    return
  }

  const subject = normalizeReplySubject(params.message.subject)
  const body = buildBookingReplyBody({
    calendlyUrl,
    senderCompany: params.profile?.company_name ?? 'Bombsell',
  })
  const result = await sendWithConnectedAccount({
    userId: params.userId,
    supabase: params.supabase,
    to: recipient,
    subject,
    body,
    fromName: params.profile?.company_name ?? params.accountEmail,
    inReplyTo: params.message.messageId ?? null,
    gmailThreadId: params.message.provider === 'gmail' ? params.message.threadId ?? null : null,
    preferEmail: params.accountEmail,
  })

  if (!result) {
    await recordAgentEvent(params.supabase, {
      userId: params.userId,
      clientId: params.lead.client_id ?? null,
      leadId: params.lead.id,
      agentName: 'booking',
      eventType: 'booking_reply_blocked',
      status: 'blocked',
      title: 'Booking reply blocked: no connected inbox',
      body: 'Bombsell detected meeting intent but could not send the booking link.',
    })
    return
  }

  await params.supabase
    .from('leads')
    .update({ booking_reply_sent_at: params.now })
    .eq('id', params.lead.id)
    .eq('user_id', params.userId)

  await recordAgentEvent(params.supabase, {
    userId: params.userId,
    clientId: params.lead.client_id ?? null,
    leadId: params.lead.id,
    agentName: 'booking',
    eventType: 'booking_link_sent',
    status: 'completed',
    title: `Sent booking link to ${params.lead.target_company ?? 'lead'}`,
    body: `Bombsell replied with the booking link from ${result.fromEmail}.`,
    metadata: {
      to: recipient,
      provider: result.provider,
      message_id: result.messageId,
      thread_id: result.threadId,
    },
  })
}

async function stopPendingFollowups(
  supabase: SupabaseClient,
  leadId: string,
  now: string,
) {
  await supabase.from('scheduled_followups')
    .update({
      sent_at: now,
      processing_started_at: null,
      processing_token: null,
    })
    .eq('lead_id', leadId)
    .is('sent_at', null)
}

function extractEmailAddress(value: string): string {
  const angleMatch = value.match(/<([^>]+)>/)
  return (angleMatch?.[1] ?? value).trim().replace(/^mailto:/i, '')
}

function normalizeReplySubject(subject: string | null | undefined): string {
  const cleaned = (subject ?? '').replace(/[\r\n\0]+/g, ' ').trim()
  if (!cleaned) return 'Re: quick follow-up'
  return /^re:/i.test(cleaned) ? cleaned : `Re: ${cleaned}`
}

function cleanReplyText(value: string): string {
  return value
    .replace(/On .+ wrote:\s*[\s\S]*$/i, '')
    .replace(/From:\s*.+\nSent:\s*.+[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}
