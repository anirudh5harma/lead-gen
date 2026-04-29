import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchOutlookMessageMeta } from '@/lib/oauth/outlook-watch'
import { getValidAccessToken, type ConnectedAccount } from '@/lib/oauth/sender'
import { normalizeMessageId } from '@/lib/oauth/message-id'

type AccountRow = ConnectedAccount & {
  user_id:               string
  outlook_client_state:  string | null
  outlook_subscription_id: string | null
}

// Microsoft Graph sends a GET with ?validationToken=... when creating a subscription.
// Must respond with the token as plain text within 10 seconds.
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('validationToken')
  if (!token) return NextResponse.json({ error: 'Missing validationToken' }, { status: 400 })
  return new Response(token, { headers: { 'Content-Type': 'text/plain' } })
}

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ ok: true }) }

  const notifications = (body as { value?: unknown[] })?.value
  if (!Array.isArray(notifications) || !notifications.length) return NextResponse.json({ ok: true })

  const supabase = await createServiceClient()
  const now      = new Date().toISOString()

  for (const note of notifications) {
    const n = note as {
      subscriptionId?: string
      clientState?:    string
      resourceData?:   { id?: string }
    }

    const subscriptionId = n.subscriptionId
    const messageId      = n.resourceData?.id
    if (!subscriptionId || !messageId) continue

    // Look up connected account by subscription ID
    const { data: account } = await supabase
      .from('connected_accounts')
      .select('id, user_id, provider, email, display_name, access_token, refresh_token, token_expires_at, outlook_client_state, outlook_subscription_id')
      .eq('outlook_subscription_id', subscriptionId)
      .eq('is_active', true)
      .single()

    if (!account) continue
    const acc = account as AccountRow

    // Validate clientState to confirm this notification is for our subscription
    if (acc.outlook_client_state && n.clientState !== acc.outlook_client_state) continue

    const accessToken = await getValidAccessToken(acc, supabase)
    const meta = await fetchOutlookMessageMeta(accessToken, messageId)
    if (!meta) continue

    let lead: { id: string; status: string } | null = null

    // Primary match: same Outlook conversation as the original outreach
    if (meta.conversationId) {
      const { data: byConv } = await supabase
        .from('leads')
        .select('id, status')
        .eq('user_id', acc.user_id)
        .eq('gmail_thread_id', meta.conversationId)  // column reused for Outlook conversationId
        .eq('status', 'sent')
        .maybeSingle()
      lead = byConv
    }

    // Fallback: match by In-Reply-To → stored message_id (RFC 2822 internetMessageId)
    if (!lead && meta.inReplyTo) {
      const raw = normalizeMessageId(meta.inReplyTo)
      if (raw) {
        const { data: byMsgId } = await supabase
          .from('leads')
          .select('id, status')
          .eq('user_id', acc.user_id)
          .eq('message_id', raw)
          .eq('status', 'sent')
          .maybeSingle()
        lead = byMsgId
      }
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

  // Graph requires a 202 to acknowledge
  return new Response(null, { status: 202 })
}
