import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import { canSendEmail, incrementSendCount, getUserPlan, getPlanLimits } from '@/lib/plan'
import { checkRateLimit } from '@/lib/rate-limit'

const UNSUBSCRIBE_BASE = `${process.env.NEXT_PUBLIC_APP_URL}/api/outreach/unsubscribe`

function unsubscribeUrl(email: string): string {
  const token = Buffer.from(email).toString('base64url')
  return `${UNSUBSCRIBE_BASE}?token=${token}`
}

function appendUnsubscribeFooter(text: string, email: string): string {
  return `${text}\n\n---\nTo unsubscribe, visit: ${unsubscribeUrl(email)}`
}

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

  const { leadId, to, subject, body: emailBody } = body as {
    leadId: string; to: string; subject: string; body: string
  }

  if (!leadId || !to || !subject || !emailBody) {
    return NextResponse.json({ error: 'leadId, to, subject, and body must be non-empty' }, { status: 400 })
  }
  if (subject.length > 998 || emailBody.length > 100_000) {
    return NextResponse.json({ error: 'Subject or body exceeds maximum length' }, { status: 400 })
  }

  const rl = await checkRateLimit(`send:${user.id}`, 5, 3600)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many sends. Limit is 5 per hour.' },
      { status: 429, headers: { 'Retry-After': '3600' } }
    )
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: 'Email sending is not configured. Add RESEND_API_KEY to your environment.' },
      { status: 503 }
    )
  }

  // Verify lead belongs to this user
  const { data: lead } = await supabase
    .from('leads')
    .select('id, status')
    .eq('id', leadId)
    .eq('user_id', user.id)
    .single()

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Check send quota (Free: 15/30 days, Pro: 150/30 days, Max: unlimited)
  const allowed = await canSendEmail(user.id)
  if (!allowed) {
    return NextResponse.json(
      { error: 'You\'ve reached your send limit for this 30-day period. Upgrade to send more.' },
      { status: 429 }
    )
  }

  // Check unsubscribe list
  const { data: unsub } = await supabase
    .from('unsubscribed_emails')
    .select('id')
    .eq('email', to.toLowerCase())
    .maybeSingle()

  if (unsub) {
    return NextResponse.json(
      { error: 'This recipient has unsubscribed.' },
      { status: 422 }
    )
  }

  // Check bounce/complaint suppression
  const { data: bounced } = await supabase
    .from('bounced_emails')
    .select('reason')
    .eq('email', to.toLowerCase())
    .maybeSingle()

  if (bounced) {
    return NextResponse.json(
      { error: `Cannot send to this address (${bounced.reason}).` },
      { status: 422 }
    )
  }

  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const fromAddress = process.env.RESEND_FROM ?? 'outreach@bombsell.com'

    const bodyWithFooter = appendUnsubscribeFooter(emailBody, to)

    const { data: sent, error: resendErr } = await resend.emails.send({
      from: fromAddress,
      to,
      subject,
      text: bodyWithFooter,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl(to)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })

    if (resendErr) throw new Error(resendErr.message)

    const now = new Date().toISOString()
    await supabase
      .from('leads')
      .update({ status: 'sent', sent_at: now, message_id: sent?.id ?? null })
      .eq('id', leadId)

    // Increment send counter (counts against the 30-day quota)
    await incrementSendCount(user.id)

    // Schedule follow-up for Pro/Max users (3 days out)
    const { plan } = await getUserPlan(user.id)
    if (getPlanLimits(plan).followups) {
      const followAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('scheduled_followups').upsert(
        { user_id: user.id, lead_id: leadId, scheduled_for: followAt },
        { onConflict: 'lead_id' }
      )
    }

    return NextResponse.json({ success: true, messageId: sent?.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email'
    console.error('[outreach/send]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
