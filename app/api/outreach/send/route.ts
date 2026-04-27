import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canUseConnectedSending, getPlanLimits, normalizePlanTier } from '@/lib/plan'
import { checkRateLimit } from '@/lib/rate-limit'
import { draftFollowUpEmail } from '@/lib/deepseek'
import { normalizeLeadFeedSnapshot } from '@/lib/lead-sources'
import { sendWithConnectedAccount } from '@/lib/oauth/sender'
import { emitCrmLeadEvent } from '@/lib/crm-sync'
import { resolveOutreachContext, scheduleFollowupAt } from '@/lib/outreach-context'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const { leadId, to, subject, body: emailBody, isFollowUp } = body as {
    leadId: string; to: string; subject: string; body: string; isFollowUp?: boolean
  }

  if (!leadId || !to || !subject || !emailBody) {
    return NextResponse.json({ error: 'leadId, to, subject, and body must be non-empty' }, { status: 400 })
  }
  if (subject.length > 998 || emailBody.length > 100_000) {
    return NextResponse.json({ error: 'Subject or body exceeds maximum length' }, { status: 400 })
  }

  const [leadRes, profileRes] = await Promise.all([
    supabase.from('leads').select('id, status, is_unlocked, client_id, target_company').eq('id', leadId).eq('user_id', user.id).single(),
    supabase.from('user_profiles').select('company_name, services_description, calendly_url, plan').eq('user_id', user.id).single(),
  ])

  if (!leadRes.data) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!leadRes.data.is_unlocked) {
    return NextResponse.json({ error: 'Unlock this lead first before sending outreach.' }, { status: 403 })
  }

  const userPlan = normalizePlanTier(profileRes.data?.plan)
  const planLimits = getPlanLimits(userPlan)
  if (!canUseConnectedSending(userPlan)) {
    return NextResponse.json(
      { error: 'Direct Gmail/Outlook sending is available on Pro. Free users can open Gmail or copy the draft from the outreach drawer.' },
      { status: 403 }
    )
  }

  const rl = await checkRateLimit(`send:${user.id}`, 5, 3600)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many sends. Limit is 5 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  const [unsubRes, bounceRes] = await Promise.all([
    supabase.from('unsubscribed_emails').select('id').eq('email', to.toLowerCase()).maybeSingle(),
    supabase.from('bounced_emails').select('reason').eq('email', to.toLowerCase()).maybeSingle(),
  ])

  if (unsubRes.data) return NextResponse.json({ error: 'This recipient has unsubscribed.' }, { status: 422 })
  if (bounceRes.data) return NextResponse.json({ error: `Cannot send to this address (${bounceRes.data.reason}).` }, { status: 422 })

  try {
    const clientId = (leadRes.data as { client_id?: string | null }).client_id ?? null
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

        const result = await sendWithConnectedAccount({
      userId:   user.id,
      supabase,
      to,
      subject,
      body:     emailBody,
      fromName: outreachContext.fromName,
    })

    if (!result) {
      return NextResponse.json(
        { error: 'No sending account connected. Go to Settings → Sending Accounts to connect Gmail or Outlook.' },
        { status: 503 }
      )
    }

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

    if (planLimits.followups && !isFollowUp) {
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

    return NextResponse.json({ success: true, messageId: result.messageId, fromEmail: result.fromEmail })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    console.error('[outreach/send]', message)
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
