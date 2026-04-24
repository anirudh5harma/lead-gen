import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getNewInboxMessages } from '@/lib/oauth/gmail-watch'
import { getValidAccessToken, type ConnectedAccount } from '@/lib/oauth/sender'

type AccountRow = ConnectedAccount & { gmail_history_id: string | null; user_id: string }

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: true }) }

  // Pub/Sub push payload: message.data is base64-encoded JSON {emailAddress, historyId}
  const encoded = (body as { message?: { data?: string } })?.message?.data
  if (!encoded) return NextResponse.json({ ok: true })

  let emailAddress: string
  let newHistoryId: string
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64').toString()) as {
      emailAddress?: string; historyId?: number | string
    }
    if (!decoded.emailAddress || !decoded.historyId) throw new Error('invalid')
    emailAddress = decoded.emailAddress
    newHistoryId = String(decoded.historyId)
  } catch {
    return NextResponse.json({ ok: true })
  }

  const supabase = await createServiceClient()

  const { data: account } = await supabase
    .from('connected_accounts')
    .select('id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, gmail_history_id')
    .eq('email', emailAddress)
    .eq('provider', 'gmail')
    .eq('is_active', true)
    .single()

  if (!account) return NextResponse.json({ ok: true })

  const acc = account as AccountRow

  // Always advance the stored historyId so we don't reprocess on the next notification
  const startHistoryId = acc.gmail_history_id ?? newHistoryId
  await supabase
    .from('connected_accounts')
    .update({ gmail_history_id: newHistoryId })
    .eq('id', acc.id)

  if (!acc.gmail_history_id) return NextResponse.json({ ok: true })

  const accessToken = await getValidAccessToken(acc, supabase)
  const { messages } = await getNewInboxMessages(accessToken, startHistoryId)

  const now = new Date().toISOString()

  for (const msg of messages) {
    // Ignore messages sent by the account itself (e.g. sent mail appearing in INBOX)
    if (msg.from.toLowerCase().includes(emailAddress.toLowerCase())) continue

    let lead: { id: string; status: string } | null = null

    // Primary match: same Gmail thread as the original outreach
    const { data: byThread } = await supabase
      .from('leads')
      .select('id, status')
      .eq('user_id', acc.user_id)
      .eq('gmail_thread_id', msg.threadId)
      .eq('status', 'sent')
      .maybeSingle()
    lead = byThread

    // Fallback: match by In-Reply-To header → message_id stored on lead
    if (!lead && msg.inReplyTo) {
      const raw = msg.inReplyTo.replace(/^<|>$/g, '')
      const { data: byMsgId } = await supabase
        .from('leads')
        .select('id, status')
        .eq('user_id', acc.user_id)
        .eq('message_id', raw)
        .eq('status', 'sent')
        .maybeSingle()
      lead = byMsgId
    }

    if (!lead) continue

    await supabase.from('leads').update({ status: 'replied', replied_at: now }).eq('id', lead.id)
    await supabase.from('scheduled_followups')
      .update({
        sent_at: now,
        processing_started_at: null,
        processing_token: null,
      })
      .eq('lead_id', lead.id)
      .is('sent_at', null)
  }

  return NextResponse.json({ ok: true })
}
