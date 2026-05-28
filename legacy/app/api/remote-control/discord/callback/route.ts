import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyOAuthState } from '@/lib/oauth/state'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const dash = `${BASE || url.origin}/dashboard?view=integrations`

  if (error || !code || !state) {
    return NextResponse.redirect(`${dash}&remote_control_error=discord_denied`)
  }

  const stateValue = verifyOAuthState(state)
  if (!stateValue) {
    return NextResponse.redirect(`${dash}&remote_control_error=invalid_state`)
  }

  const [userId, clientIdRaw = ''] = stateValue.split(':')
  if (!userId) return NextResponse.redirect(`${dash}&remote_control_error=invalid_state`)

  try {
    const token = await exchangeDiscordCode(code, `${BASE || url.origin}/api/remote-control/discord/callback`)
    const profile = await fetchDiscordUser(token.access_token)
    const supabase = await createServiceClient()
    const { error: upsertError } = await supabase.from('remote_control_identities').upsert({
      user_id: userId,
      client_id: clientIdRaw || null,
      provider: 'discord',
      provider_user_id: profile.id,
      provider_chat_id: null,
      username: profile.username ?? null,
      enabled: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider,provider_user_id' })
    if (upsertError) throw new Error(upsertError.message)
    return NextResponse.redirect(`${dash}&remote_control_connected=discord`)
  } catch (connectError) {
    console.error('[remote-control/discord/callback]', connectError)
    return NextResponse.redirect(`${dash}&remote_control_error=discord_failed`)
  }
}

async function exchangeDiscordCode(code: string, redirectUri: string): Promise<{ access_token: string }> {
  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Discord OAuth is not configured.')

  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = await response.json().catch(() => ({})) as { access_token?: string; error_description?: string }
  if (!response.ok || !json.access_token) throw new Error(json.error_description || 'Could not connect Discord.')
  return { access_token: json.access_token }
}

async function fetchDiscordUser(accessToken: string): Promise<{ id: string; username?: string }> {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  })
  const json = await response.json().catch(() => ({})) as { id?: string; username?: string; message?: string }
  if (!response.ok || !json.id) throw new Error(json.message || 'Could not load Discord user.')
  return { id: json.id, username: json.username }
}
