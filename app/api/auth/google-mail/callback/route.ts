import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { exchangeGoogleCode } from '@/lib/oauth/google'
import { startGmailWatch } from '@/lib/oauth/gmail-watch'

const BASE = process.env.NEXT_PUBLIC_APP_URL!

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_error=google_denied`)
  }

  let userId: string
  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString()) as { userId?: string }
    if (!decoded.userId) throw new Error('missing userId')
    userId = decoded.userId
  } catch {
    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_error=invalid_state`)
  }

  try {
    const tokens  = await exchangeGoogleCode(code)
    const supabase = await createServiceClient()

    // Upsert the account first so we have an ID to update
    const { data: account } = await supabase.from('connected_accounts').upsert({
      user_id:          userId,
      provider:         'gmail',
      email:            tokens.email,
      display_name:     tokens.name,
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      is_active:        true,
    }, { onConflict: 'user_id,email' }).select('id').single()

    // Start inbox watch for reply detection (best-effort — don't fail the connect if watch fails)
    const pubsubTopic = process.env.GOOGLE_PUBSUB_TOPIC
    if (pubsubTopic && account) {
      try {
        const watch = await startGmailWatch(tokens.access_token, pubsubTopic)
        await supabase.from('connected_accounts')
          .update({ gmail_history_id: watch.historyId })
          .eq('id', account.id)
      } catch (watchErr) {
        console.error('[google-mail/callback] watch setup failed:', watchErr)
      }
    }

    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_connected=gmail`)
  } catch (err) {
    console.error('[google-mail/callback]', err)
    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_error=google_failed`)
  }
}
