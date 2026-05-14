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
  const rawPlatform = url.searchParams.get('platform')
  const error = url.searchParams.get('error')
  const dash = `${url.origin}/dashboard?view=integrations`

  if (error) return NextResponse.redirect(`${dash}&social_error=${encodeURIComponent(error)}`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${url.origin}/`)
  const { data: profileRow } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profileRow?.active_client_id as string | null) ?? user.id

  // List ALL connected accounts from Post for Me for this workspace.
  // This is resilient to the platform param being stripped by Post for Me's redirect.
  const accounts = await listAccounts({ externalId: workspaceId })
  if (accounts.length === 0) return NextResponse.redirect(`${dash}&social_error=no_accounts`)

  let activated = 0
  for (const account of accounts) {
    const platform = account.platform === 'x' || account.platform === 'twitter' ? 'x'
      : account.platform === 'linkedin' ? 'linkedin'
      : null
    if (!platform) continue

    // Upsert: activate if a row exists, create if it doesn't.
    const { error: upsertError } = await supabase.from('social_accounts').upsert({
      workspace_id: workspaceId,
      user_id: user.id,
      partner: 'postforme',
      platform,
      api_key: null,
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
    }, { onConflict: 'workspace_id,partner,platform' })
    if (!upsertError) activated++
  }

  if (activated === 0) return NextResponse.redirect(`${dash}&social_error=activation_failed`)

  return NextResponse.redirect(`${dash}&social_connected=${activated}`)
}
