import { NextResponse } from 'next/server'
import {
  exchangeDistributionCode,
  isDistributionProvider,
  verifyDistributionOAuthState,
} from '@/lib/distribution'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: rawProvider } = await params
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  if (!isDistributionProvider(rawProvider) || error || !code || !state) {
    return NextResponse.redirect(`${BASE}/dashboard?view=marketing/content&distribution_error=connect_denied`)
  }

  const verified = verifyDistributionOAuthState(state)
  if (!verified || verified.provider !== rawProvider) {
    return NextResponse.redirect(`${BASE}/dashboard?view=marketing/content&distribution_error=invalid_state`)
  }

  try {
    const supabase = await createServiceClient()
    const result = await exchangeDistributionCode(rawProvider, code, verified.codeVerifier)
    const expiresAt = result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000).toISOString() : null
    let existingQuery = supabase
      .from('connected_distribution_accounts')
      .select('id')
      .eq('user_id', verified.userId)
      .eq('provider', rawProvider)
      .eq('provider_account_id', result.profile.providerAccountId)
      .limit(1)
    existingQuery = verified.clientId ? existingQuery.eq('client_id', verified.clientId) : existingQuery.is('client_id', null)
    const { data: existing } = await existingQuery.maybeSingle()

    const accountRow = {
      user_id: verified.userId,
      client_id: verified.clientId,
      provider: rawProvider,
      provider_account_id: result.profile.providerAccountId,
      display_name: result.profile.displayName,
      handle: result.profile.handle,
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_expires_at: expiresAt,
      scopes: result.scopes,
      status: 'connected',
      publish_mode: 'manual_review',
      metadata: result.profile.metadata ?? {},
    }

    const { error: upsertError } = existing?.id
      ? await supabase.from('connected_distribution_accounts').update(accountRow).eq('id', existing.id)
      : await supabase.from('connected_distribution_accounts').insert(accountRow)

    if (upsertError) throw new Error(upsertError.message)
    return NextResponse.redirect(`${BASE}/dashboard?view=marketing/content&distribution_connected=${rawProvider}`)
  } catch (connectError) {
    console.error('[distribution/callback]', connectError)
    return NextResponse.redirect(`${BASE}/dashboard?view=marketing/content&distribution_error=${rawProvider}_failed`)
  }
}
