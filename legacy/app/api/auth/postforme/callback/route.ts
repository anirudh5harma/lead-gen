/**
 * Post for Me connect-flow callback. After the user authorizes a social account
 * on Post for Me's hosted page, they're redirected here. We list the workspace's
 * connected accounts from Post for Me and activate / upsert the matching
 * `social_accounts` row.
 *
 * Does NOT require a pre-created pending row — works with or without the
 * platform query param (Post for Me may strip custom params from the redirect).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listAccounts } from '@/lib/social/postforme'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const dash = `${url.origin}/dashboard?view=integrations`

  if (error) return NextResponse.redirect(`${dash}&social_error=${encodeURIComponent(error)}`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${url.origin}/`)
  const { data: profileRow } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profileRow?.active_client_id as string | null) ?? user.id

  // List ALL connected accounts from Post for Me for this workspace.
  const accounts = await listAccounts({ externalId: workspaceId })
  if (accounts.length === 0) return NextResponse.redirect(`${dash}&social_error=no_accounts`)

  let activated = 0
  for (const account of accounts) {
    const platform = account.platform === 'x' || account.platform === 'twitter' ? 'x'
      : account.platform === 'linkedin' ? 'linkedin'
      : null
    if (!platform) continue

    // Query-then-upsert: avoid ON CONFLICT mismatches with the
    // COALESCE(platform, 'all') unique index.
    const { data: existing } = await supabase
      .from('social_accounts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('partner', 'postforme')
      .eq('platform', platform)
      .maybeSingle()

    const row = {
      workspace_id: workspaceId,
      user_id: user.id,
      partner: 'postforme' as const,
      platform,
      api_key: null as string | null,
      external_account_id: account.id,
      display_name: account.username ?? platform,
      is_active: true,
      metadata: {
        handle: account.username ?? null,
        profile_photo_url: account.profile_photo_url ?? null,
        external_id: workspaceId,
        postforme_platform: account.platform,
      },
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from('social_accounts')
        .update(row)
        .eq('id', existing.id)
      if (!updateError) activated++
    } else {
      const { error: insertError } = await supabase
        .from('social_accounts')
        .insert(row)
      if (!insertError) activated++
    }
  }

  if (activated === 0) return NextResponse.redirect(`${dash}&social_error=activation_failed`)

  return NextResponse.redirect(`${dash}&social_connected=${activated}`)
}
