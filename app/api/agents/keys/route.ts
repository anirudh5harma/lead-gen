import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/a2a/agent-auth'

// GET /api/agents/keys?agent_id=xxx - list API keys for an agent
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agent_id')
  if (!agentId) return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })

  const { data: keys } = await supabase
    .from('agent_api_keys')
    .select('id, agent_id, key_prefix, name, scopes, rate_limit_tier, last_used_at, expires_at, revoked_at, created_at')
    .eq('agent_id', agentId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ keys: keys ?? [] })
}

// POST /api/agents/keys - create a new API key
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as {
    agent_id?: string
    name?: string
    scopes?: string[]
    expires_at?: string
  } | null

  if (!body?.agent_id) {
    return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })
  }

  // Verify agent ownership
  const { data: agent } = await supabase
    .from('agent_identities')
    .select('id')
    .eq('id', body.agent_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const { key, hash, prefix } = generateApiKey()

  const { data: keyRow, error } = await supabase
    .from('agent_api_keys')
    .insert({
      agent_id: body.agent_id,
      user_id: user.id,
      key_hash: hash,
      key_prefix: prefix,
      name: body.name ?? 'Default',
      scopes: body.scopes ?? ['read:signals', 'read:accounts'],
      expires_at: body.expires_at ?? null,
    })
    .select('id, agent_id, key_prefix, name, scopes, rate_limit_tier, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ key: keyRow, api_key: key }, { status: 201 })
}

// DELETE /api/agents/keys - revoke an API key
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null) as { key_id?: string } | null
  if (!body?.key_id) {
    return NextResponse.json({ error: 'key_id is required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('agent_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', body.key_id)
    .eq('user_id', user.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
