import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Resend inbound webhook — fires when a reply arrives at the catch-all address
// Configure in Resend dashboard: Inbound → webhook URL = /api/webhooks/email
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (secret) {
    const sig = request.headers.get('resend-signature')
    if (sig !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Resend inbound email event shape
  const p = payload as {
    type?: string
    data?: {
      headers?: { name: string; value: string }[]
      from?: string
    }
  }

  if (p.type !== 'email.received') {
    return NextResponse.json({ ok: true })
  }

  const headers = p.data?.headers ?? []
  const inReplyTo = headers.find(h => h.name.toLowerCase() === 'in-reply-to')?.value?.trim()
  if (!inReplyTo) return NextResponse.json({ ok: true })

  // Strip angle brackets from Message-ID
  const messageId = inReplyTo.replace(/^<|>$/g, '')

  const supabase = await createServiceClient()
  const { data: lead } = await supabase
    .from('leads')
    .select('id, status, user_id')
    .eq('message_id', messageId)
    .maybeSingle()

  if (!lead || lead.status === 'replied' || lead.status === 'booked') {
    return NextResponse.json({ ok: true })
  }

  await supabase
    .from('leads')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', lead.id)

  return NextResponse.json({ ok: true, leadId: lead.id })
}
