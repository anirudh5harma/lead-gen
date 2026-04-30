import type { SupabaseClient } from '@supabase/supabase-js'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { recordAgentEvent } from '@/lib/agent-events'
import { normalizeEmailAddress } from '@/lib/email-safety'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { sendReplyOutcomeEmail } from '@/lib/resend'
import { upsertLeadIntoGtmGraph, recordGtmTouchpoint } from '@/lib/gtm/graph'
import { bodyPreview } from '@/lib/gtm/identity'
import { recordGtmMemory } from '@/lib/gtm/memory'
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

  await recordReplyInGtmMemory({
    supabase,
    userId,
    leadId: lead.id,
    clientId: lead.client_id ?? null,
    now,
    intent,
    message,
    text,
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

async function recordReplyInGtmMemory(params: {
  supabase: SupabaseClient
  userId: string
  leadId: string
  clientId: string | null
  now: string
  intent: ReturnType<typeof classifyReplyIntent>
  message: InboundReplyMessage
  text: string
}) {
  const { data: lead } = await params.supabase
    .from('leads')
    .select('id, user_id, client_id, target_company, company_domain, relevance_score, relevance_reason, status, is_unlocked, contact_email, contact_name, contact_title, contact_verified, origin, source_kind, feed_snapshot, created_at')
    .eq('id', params.leadId)
    .eq('user_id', params.userId)
    .maybeSingle()

  if (!lead) return

  const graph = await upsertLeadIntoGtmGraph(params.supabase, {
    id: lead.id,
    user_id: params.userId,
    client_id: (lead as { client_id?: string | null }).client_id ?? params.clientId,
    target_company: lead.target_company,
    company_domain: (lead as { company_domain?: string | null }).company_domain ?? null,
    relevance_score: (lead as { relevance_score?: number | null }).relevance_score ?? null,
    relevance_reason: (lead as { relevance_reason?: string | null }).relevance_reason ?? null,
    status: (lead as { status?: string | null }).status ?? null,
    is_unlocked: (lead as { is_unlocked?: boolean | null }).is_unlocked ?? true,
    contact_email: (lead as { contact_email?: string | null }).contact_email ?? null,
    contact_name: (lead as { contact_name?: string | null }).contact_name ?? null,
    contact_title: (lead as { contact_title?: string | null }).contact_title ?? null,
    contact_verified: (lead as { contact_verified?: boolean | null }).contact_verified ?? null,
    origin: (lead as { origin?: string | null }).origin ?? null,
    source_kind: (lead as { source_kind?: string | null }).source_kind ?? null,
    feed_snapshot: (lead as { feed_snapshot?: unknown }).feed_snapshot,
    created_at: (lead as { created_at?: string | null }).created_at ?? null,
  })
  if (!graph) return

  await recordGtmTouchpoint(params.supabase, {
    userId: params.userId,
    clientId: params.clientId,
    accountId: graph.accountId,
    personId: graph.personId,
    leadId: params.leadId,
    type: 'reply',
    status: 'received',
    subject: params.message.subject ?? null,
    bodyPreview: bodyPreview(params.text || params.intent.summary),
    fromEmail: params.message.from,
    provider: params.message.provider,
    messageId: params.message.messageId ?? null,
    occurredAt: params.now,
    metadata: {
      intent: params.intent.intent,
      confidence: params.intent.confidence,
      thread_id: params.message.threadId ?? null,
    },
  })

  await recordGtmMemory(params.supabase, {
    userId: params.userId,
    clientId: params.clientId,
    scope: 'entity',
    entityType: 'account',
    entityId: graph.accountId,
    memoryType: 'reply_outcome',
    content: `Reply intent: ${params.intent.intent}. ${params.intent.summary}`,
    source: `${params.message.provider}_reply_webhook`,
    confidence: params.intent.confidence,
    observedAt: params.now,
    provenance: {
      lead_id: params.leadId,
      message_id: params.message.messageId ?? null,
      thread_id: params.message.threadId ?? null,
    },
  })
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
