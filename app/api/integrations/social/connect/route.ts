/**
 * Start the managed (Post for Me) social-account connect flow.
 * POST { platform: 'linkedin' | 'x' } → { url }  — a hosted OAuth page where the
 * user authorizes their account; Post for Me redirects back to
 * /api/auth/postforme/callback.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { postformeEnabled, createConnectUrl, type PostForMePlatform } from '@/lib/social/postforme'

export async function POST(request: Request) {
  if (!postformeEnabled()) return NextResponse.json({ error: 'Managed social publishing is not configured.' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profileRow } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  const workspaceId = (profileRow?.active_client_id as string | null) ?? user.id

  const body = await request.json().catch(() => null) as { platform?: string } | null
  const platform = (body?.platform === 'linkedin' || body?.platform === 'x') ? (body.platform as PostForMePlatform) : null
  if (!platform) return NextResponse.json({ error: 'platform must be "linkedin" or "x"' }, { status: 400 })

  // pending row so the callback can find/activate it
  await supabase.from('social_accounts').upsert({
    workspace_id: workspaceId, user_id: user.id, partner: 'postforme', platform,
    api_key: null, external_account_id: null, display_name: `${platform} (connecting…)`,
    is_active: false, metadata: {}, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,partner,platform' })

  const origin = new URL(request.url).origin
  const redirectUrl = `${origin}/api/auth/postforme/callback?platform=${platform}`
  const conn = await createConnectUrl({ platform, redirectUrl, externalId: workspaceId })
  if (!conn.ok || !conn.url) return NextResponse.json({ error: conn.error ?? 'Could not start connect flow' }, { status: 502 })
  return NextResponse.json({ url: conn.url })
}
