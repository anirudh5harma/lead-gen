import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Resend sends a signature in `svix-signature` header (same format as standardwebhooks)
// https://resend.com/docs/dashboard/webhooks/introduction

interface ResendEmailBounced {
  type: 'email.bounced'
  data: { email_id: string; from: string; to: string[]; created_at: string }
}

interface ResendEmailComplained {
  type: 'email.complained'
  data: { email_id: string; from: string; to: string[]; created_at: string }
}

type ResendEvent = ResendEmailBounced | ResendEmailComplained

export async function POST(request: Request) {
  const rawBody = await request.text()

  // Verify webhook signature (Resend uses svix headers)
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET
  if (webhookSecret) {
    const svixId        = request.headers.get('svix-id') ?? ''
    const svixTimestamp = request.headers.get('svix-timestamp') ?? ''
    const svixSignature = request.headers.get('svix-signature') ?? ''

    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })
    }

    // Compute expected signature: HMAC-SHA256(secret, `${svix-id}.${svix-timestamp}.${body}`)
    const encoder = new TextEncoder()
    const keyData = Uint8Array.from(atob(webhookSecret.replace('whsec_', '')), c => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const payload = encoder.encode(`${svixId}.${svixTimestamp}.${rawBody}`)
    const sigBuffer = await crypto.subtle.sign('HMAC', key, payload)
    const computed = `v1,${btoa(String.fromCharCode(...new Uint8Array(sigBuffer)))}`

    const signatures = svixSignature.split(' ')
    const valid = signatures.some(s => s === computed)
    if (!valid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let event: ResendEvent
  try {
    event = JSON.parse(rawBody) as ResendEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (event.type !== 'email.bounced' && event.type !== 'email.complained') {
    return NextResponse.json({ ok: true })
  }

  const supabase = await createServiceClient()
  const reason = event.type === 'email.bounced' ? 'bounce' : 'complaint'
  const recipients = event.data.to ?? []

  for (const email of recipients) {
    const normalized = email.toLowerCase()

    // Insert into bounce suppression table (ignore conflict = already suppressed)
    await supabase.from('bounced_emails').upsert(
      { email: normalized, reason },
      { onConflict: 'email' }
    )

    // Update any leads with this contact email to mark as bounced
    if (event.type === 'email.bounced') {
      await supabase.from('leads')
        .update({ contact_verified: false })
        .eq('contact_email', normalized)
    }
  }

  // Also update lead status if we have a message_id match
  const messageId = event.data.email_id
  if (messageId && event.type === 'email.bounced') {
    await supabase.from('leads')
      .update({ status: 'bounced' } as Record<string, unknown>)
      .eq('message_id', messageId)
  }

  return NextResponse.json({ ok: true })
}
