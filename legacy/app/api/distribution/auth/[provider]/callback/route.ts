import { NextResponse } from 'next/server'
import {
  exchangeDistributionCode,
  isPublishModeQueueEligible,
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
      .select('id, publish_mode')
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
      publish_mode: normalizePublishMode((existing as { publish_mode?: unknown } | null)?.publish_mode),
      metadata: result.profile.metadata ?? {},
    }

    const upsertResult = existing?.id
      ? await supabase
          .from('connected_distribution_accounts')
          .update(accountRow)
          .eq('id', existing.id)
          .select('id, publish_mode')
          .single()
      : await supabase
          .from('connected_distribution_accounts')
          .insert(accountRow)
          .select('id, publish_mode')
          .single()

    if (upsertResult.error) throw new Error(upsertResult.error.message)

    const connectedAccountId = (upsertResult.data as { id?: string } | null)?.id ?? null
    const publishMode = normalizePublishMode((upsertResult.data as { publish_mode?: unknown } | null)?.publish_mode)

    if (connectedAccountId && isPublishModeQueueEligible(publishMode)) {
      let requeueQuery = supabase
        .from('content_distribution_jobs')
        .update({
          status: 'queued',
          connected_distribution_account_id: connectedAccountId,
          error_message: null,
        })
        .eq('user_id', verified.userId)
        .eq('provider', rawProvider)
        .eq('status', 'manual_ready')
        .not('scheduled_for', 'is', null)
      requeueQuery = verified.clientId ? requeueQuery.eq('client_id', verified.clientId) : requeueQuery.is('client_id', null)
      const { error: requeueError } = await requeueQuery
      if (requeueError) {
        console.error('[distribution/callback] manual-ready requeue failed:', requeueError.message)
      }
    }

    return NextResponse.redirect(`${BASE}/dashboard?view=marketing/content&distribution_connected=${rawProvider}`)
  } catch (connectError) {
    console.error('[distribution/callback]', connectError)
    return NextResponse.redirect(`${BASE}/dashboard?view=marketing/content&distribution_error=${rawProvider}_failed`)
  }
}

function normalizePublishMode(value: unknown): 'manual_review' | 'scheduled' | 'auto_publish' {
  if (value === 'manual_review' || value === 'scheduled' || value === 'auto_publish') return value
  return 'scheduled'
}
