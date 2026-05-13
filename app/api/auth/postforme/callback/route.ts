/**
 * Post for Me connect-flow callback. After the user authorizes a social account
 * on Post for Me's hosted page, they're redirected here. We re-list the
 * workspace's accounts (filtered by external_id = workspaceId) and activate the
 * matching `social_accounts` row.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listAccounts, type PostForMePlatform } from '@/lib/social/postforme'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const rawPlatform = url.searchParams.get('platform')
  const error = url.searchParams.get('error')
  const platform = normalizePlatform(rawPlatform)
  const dash = `${url.origin}/dashboard?view=integrations`

  if (error) return NextResponse.redirect(`${dash}&social_error=${encodeURIComponent(error)}`)
  if (rawPlatform && !platform) return NextResponse.redirect(`${dash}&social_error=invalid_platform`)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${url.origin}/`)
  const { data: profileRow } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profileRow?.active_client_id as string | null) ?? user.id

  let q = supabase
    .from('social_accounts')
    .select('id, platform')
    .eq('workspace_id', workspaceId)
    .eq('partner', 'postforme')
    .eq('is_active', false)
  if (platform) q = q.eq('platform', platform)
  const { data: rows } = await q
  if (!rows || rows.length === 0) return NextResponse.redirect(`${dash}&social_error=no_pending`)

  const accounts = await listAccounts({ externalId: workspaceId, platform: platform ?? undefined })
  let activated = 0
  for (const row of rows) {
    const rowPlatform = normalizePlatform(row.platform)
    if (!rowPlatform) continue
    const match = accounts.find((a) => normalizePlatform(a.platform) === rowPlatform)
    if (!match) continue
    await supabase.from('social_accounts').update({
      external_account_id: match.id,
      display_name: match.username ?? rowPlatform,
      is_active: true,
      metadata: {
        handle: match.username ?? null,
        profile_photo_url: match.profile_photo_url ?? null,
        external_id: workspaceId,
        postforme_platform: match.platform,
      },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    activated++
  }
  return NextResponse.redirect(`${dash}&social_connected=${activated}`)
}

function normalizePlatform(value: string | null | undefined): PostForMePlatform | null {
  if (value === 'linkedin') return 'linkedin'
  if (value === 'x' || value === 'twitter') return 'x'
  return null
}
