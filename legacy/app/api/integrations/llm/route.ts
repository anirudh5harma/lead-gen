/**
 * BYO LLM key (Claude / ChatGPT) for the workspace. When connected, drafting &
 * content generation run on the user's key (no LLM credit charge). The
 * "Bombsell Default LLM" is used otherwise.
 * GET    — list connected providers (api_key never returned)
 * POST   — connect/update: { provider: 'anthropic'|'openai', api_key, model? }
 * DELETE — disconnect: ?provider=anthropic
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const PROVIDERS = ['anthropic', 'openai'] as const

async function workspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('user_profiles').select('active_client_id').eq('user_id', user.id).maybeSingle()
  return { supabase, userId: user.id, workspaceId: (profile?.active_client_id as string | null) ?? user.id }
}

export async function GET() {
  const ctx = await workspace()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data } = await ctx.supabase.from('workspace_llm_keys')
    .select('provider, model, is_active, updated_at').eq('workspace_id', ctx.workspaceId)
  return NextResponse.json({ default: 'Bombsell Default LLM', connected: data ?? [] })
}

export async function POST(request: Request) {
  const ctx = await workspace()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as { provider?: string; api_key?: string; model?: string } | null
  if (!body || !PROVIDERS.includes(body.provider as never)) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })
  if (!body.api_key) return NextResponse.json({ error: 'api_key required' }, { status: 400 })

  // Validate the key with a tiny live call before storing it.
  try {
    if (body.provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${body.api_key}` }, signal: AbortSignal.timeout(12_000) })
      if (r.status === 401 || r.status === 403) return NextResponse.json({ error: 'OpenAI rejected that key.' }, { status: 400 })
    } else {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': body.api_key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: body.model || 'claude-haiku-4-5-20251001', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        signal: AbortSignal.timeout(12_000),
      })
      if (r.status === 401 || r.status === 403) return NextResponse.json({ error: 'Anthropic rejected that key.' }, { status: 400 })
    }
  } catch { /* network hiccup — don't block the save */ }

  const { error } = await ctx.supabase.from('workspace_llm_keys').upsert({
    workspace_id: ctx.workspaceId, user_id: ctx.userId, provider: body.provider,
    api_key: body.api_key, model: body.model ?? null, is_active: true, updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,provider' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const ctx = await workspace()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const provider = new URL(request.url).searchParams.get('provider')
  if (!provider) return NextResponse.json({ error: 'provider required' }, { status: 400 })
  const { error } = await ctx.supabase.from('workspace_llm_keys').delete().eq('workspace_id', ctx.workspaceId).eq('provider', provider)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
