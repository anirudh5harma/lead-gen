import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { exchangeMicrosoftCode } from '@/lib/oauth/microsoft'
import { createOutlookSubscription } from '@/lib/oauth/outlook-watch'
import { randomUUID } from 'crypto'
import { verifyOAuthState } from '@/lib/oauth/state'

const BASE = process.env.NEXT_PUBLIC_APP_URL!

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_error=microsoft_denied`)
  }

  const userId = verifyOAuthState(state)
  if (!userId) {
    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_error=invalid_state`)
  }

  try {
    const supabase = await createServiceClient()
    const tokens  = await exchangeMicrosoftCode(code)

    const { data: account } = await supabase.from('connected_accounts').upsert({
      user_id:          userId,
      provider:         'outlook',
      email:            tokens.email,
      display_name:     tokens.name,
      access_token:     tokens.access_token,
      refresh_token:    tokens.refresh_token,
      token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      is_active:        true,
    }, { onConflict: 'user_id,email' }).select('id').single()

    // Create inbox change notification subscription (best-effort)
    if (account) {
      try {
        const clientState = randomUUID()
        const sub = await createOutlookSubscription({
          accessToken:  tokens.access_token,
          clientState,
          webhookUrl:   `${BASE}/api/webhooks/outlook`,
        })
        await supabase.from('connected_accounts').update({
          outlook_subscription_id:  sub.subscriptionId,
          outlook_subscription_exp: sub.expiration,
          outlook_client_state:     clientState,
        }).eq('id', account.id)
      } catch (subErr) {
        console.error('[microsoft-mail/callback] subscription setup failed:', subErr)
      }
    }

    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_connected=outlook`)
  } catch (err) {
    console.error('[microsoft-mail/callback]', err)
    return NextResponse.redirect(`${BASE}/dashboard?view=settings&ca_error=microsoft_failed`)
  }
}
