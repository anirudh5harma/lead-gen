import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createRemoteControlLink, listRemoteControlConnections } from '@/lib/remote-control/linking'
import type { RemoteControlProvider } from '@/lib/remote-control/auth'
import { createOAuthState } from '@/lib/oauth/state'

export const dynamic = 'force-dynamic'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? ''

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const serviceSupabase = await createServiceClient()
  const connections = await listRemoteControlConnections(serviceSupabase, user.id)
  return NextResponse.json({
    connections,
    configured: {
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME && process.env.TELEGRAM_WEBHOOK_SECRET),
      discord: Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET && process.env.DISCORD_PUBLIC_KEY),
    },
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { provider?: string } | null
  const provider = normalizeProvider(body?.provider)
  if (!provider) return NextResponse.json({ error: 'provider must be telegram or discord' }, { status: 400 })

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('active_client_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const clientId = (profile as { active_client_id?: string | null } | null)?.active_client_id ?? null
  const serviceSupabase = await createServiceClient()

  if (provider === 'telegram') {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME
    if (!botUsername || !process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Telegram remote control is not configured.' }, { status: 503 })
    }
    const link = await createRemoteControlLink(serviceSupabase, { userId: user.id, clientId, provider })
    return NextResponse.json({
      provider,
      url: `https://t.me/${botUsername.replace(/^@/, '')}?start=${encodeURIComponent(link.token)}`,
      expires_at: link.expiresAt,
    })
  }

  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    return NextResponse.json({ error: 'Discord remote control is not configured.' }, { status: 503 })
  }

  const state = createOAuthState(`${user.id}:${clientId ?? ''}`)
  const redirectUri = `${BASE || new URL(request.url).origin}/api/remote-control/discord/callback`
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify applications.commands',
    state,
    prompt: 'consent',
  })
  return NextResponse.json({
    provider,
    url: `https://discord.com/oauth2/authorize?${params.toString()}`,
  })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { provider?: string } | null
  const provider = normalizeProvider(body?.provider)
  if (!provider) return NextResponse.json({ error: 'provider must be telegram or discord' }, { status: 400 })

  const serviceSupabase = await createServiceClient()
  const { error } = await serviceSupabase
    .from('remote_control_identities')
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('provider', provider)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

function normalizeProvider(value: string | undefined): RemoteControlProvider | null {
  if (value === 'telegram' || value === 'discord') return value
  return null
}
