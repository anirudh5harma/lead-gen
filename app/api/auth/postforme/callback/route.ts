/**
 * Post for Me connect-flow callback. After the user authorizes a social account
 * on Post for Me's hosted page, they're redirected here. We re-list the
 * workspace's accounts (filtered by external_id = workspaceId) and activate the
 * matching `social_accounts` row.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listAccounts } from '@/lib/social/postforme'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const platform = url.searchParams.get('platform')
  const dash = `${url.origin}/dashboard?view=integrations`

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${url.origin}/`)
  const { data: profileRow } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profileRow?.active_client_id as string | null) ?? user.id

  let q = supabase.from('social_accounts').select('id, platform').eq('workspace_id', workspaceId).eq('partner', 'postforme')
  if (platform === 'linkedin' || platform === 'x') q = q.eq('platform', platform)
  const { data: rows } = await q
  if (!rows || rows.length === 0) return NextResponse.redirect(`${dash}&social_error=no_pending`)

  const accounts = await listAccounts({ externalId: workspaceId })
  let activated = 0
  for (const row of rows) {
    const match = accounts.find((a) => a.platform === row.platform)
    if (!match) continue
    await supabase.from('social_accounts').update({
      external_account_id: match.id,
      display_name: match.username ?? `${row.platform}`,
      is_active: true,
      metadata: { handle: match.username ?? null, profile_photo_url: match.profile_photo_url ?? null, external_id: workspaceId },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id)
    activated++
  }
  return NextResponse.redirect(`${dash}&social_connected=${activated}`)
}
