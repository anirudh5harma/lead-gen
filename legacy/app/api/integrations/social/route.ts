/**
 * Social posting-partner connection (v2 Content engine).
 * GET    — list connected partners for the workspace (api_key never returned)
 * POST   — connect/update a partner: { partner, platform?, api_key, display_name? }
 * DELETE — disconnect: ?partner=typefully[&platform=x]
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { postformeEnabled } from '@/lib/social/postforme'

const PARTNERS = ['postforme', 'typefully', 'buffer', 'ayrshare', 'manual'] as const
const PLATFORMS = ['linkedin', 'x'] as const

async function workspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profile?.active_client_id as string | null) ?? user.id
  return { supabase, userId: user.id, workspaceId }
}

export async function GET() {
  const ctx = await workspace()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const managed = postformeEnabled()
  const { data, error } = await ctx.supabase.from('social_accounts')
    .select('id, partner, platform, display_name, is_active, created_at, updated_at')
    .eq('workspace_id', ctx.workspaceId).order('updated_at', { ascending: false })
  if (error) {
    return NextResponse.json({ accounts: [], managed, error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    accounts: data ?? [],
    managed,
    managed_reason: managed ? null : 'POSTFORME_API_KEY is not configured in this deployment.',
  })
}

export async function POST(request: Request) {
  const ctx = await workspace()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { partner?: string; platform?: string; api_key?: string; display_name?: string; external_account_id?: string } | null
  if (!body || !PARTNERS.includes(body.partner as never)) return NextResponse.json({ error: 'Invalid partner' }, { status: 400 })
  if (body.platform && !PLATFORMS.includes(body.platform as never)) return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
  if (body.partner !== 'manual' && !body.api_key) return NextResponse.json({ error: 'api_key required' }, { status: 400 })
  // Buffer needs a profile id per connected platform.
  if (body.partner === 'buffer' && !body.external_account_id) return NextResponse.json({ error: 'external_account_id (Buffer profile id) required' }, { status: 400 })
  const { error } = await ctx.supabase.from('social_accounts').upsert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId, partner: body.partner,
    platform: body.platform ?? null, api_key: body.api_key ?? null,
    external_account_id: body.external_account_id ?? null,
    display_name: body.display_name ?? body.partner, is_active: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,partner,platform' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ctx = await workspace()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const partner = url.searchParams.get('partner')
  const platform = url.searchParams.get('platform')
  if (!partner) return NextResponse.json({ error: 'partner required' }, { status: 400 })

  // For the managed partner, also revoke the connection upstream.
  if (partner === 'postforme') {
    let sel = ctx.supabase.from('social_accounts').select('external_account_id').eq('workspace_id', ctx.workspaceId).eq('partner', 'postforme')
    if (platform) sel = sel.eq('platform', platform)
    const { data: rows } = await sel
    const { disconnectAccount } = await import('@/lib/social/postforme')
    for (const r of rows ?? []) { if (r.external_account_id) await disconnectAccount(r.external_account_id as string).catch(() => {}) }
  }

  let q = ctx.supabase.from('social_accounts').delete().eq('workspace_id', ctx.workspaceId).eq('partner', partner)
  if (platform) q = q.eq('platform', platform)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
