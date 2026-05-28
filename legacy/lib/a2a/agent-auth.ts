import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

export interface AuthenticatedAgent {
  agentId: string
  userId: string
  clientId: string | null
  apiKeyId: string
  scopes: string[]
  rateLimitTier: string
}

const KEY_PREFIX = 'bsk_agt_'

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(32).toString('base64url')
  const key = `${KEY_PREFIX}${random}`
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const prefix = key.slice(0, 12)
  return { key, hash, prefix }
}

export async function authenticateAgent(request: Request): Promise<AuthenticatedAgent | NextResponse> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header. Use: Bearer <api_key>' }, { status: 401 })
  }

  const apiKey = authHeader.slice(7).trim()
  if (!apiKey.startsWith(KEY_PREFIX)) {
    return NextResponse.json({ error: 'Invalid API key format. Keys must start with bsk_agt_' }, { status: 401 })
  }

  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex')

  const supabase = createAdminClient()

  const { data: keyRow, error } = await supabase
    .from('agent_api_keys')
    .select('id, agent_id, user_id, scopes, rate_limit_tier, revoked_at, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (error || !keyRow) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  if (keyRow.revoked_at) {
    return NextResponse.json({ error: 'API key has been revoked' }, { status: 401 })
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return NextResponse.json({ error: 'API key has expired' }, { status: 401 })
  }

  // Update last_used_at
  await supabase
    .from('agent_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)

  // Get agent's client_id
  const { data: agent } = await supabase
    .from('agent_identities')
    .select('client_id, is_active')
    .eq('id', keyRow.agent_id)
    .maybeSingle()

  if (!agent?.is_active) {
    return NextResponse.json({ error: 'Agent is inactive' }, { status: 401 })
  }

  return {
    agentId: keyRow.agent_id,
    userId: keyRow.user_id,
    clientId: agent?.client_id ?? null,
    apiKeyId: keyRow.id,
    scopes: keyRow.scopes ?? [],
    rateLimitTier: keyRow.rate_limit_tier ?? 'growth',
  }
}

export function requireScope(agent: AuthenticatedAgent, scope: string): boolean {
  return agent.scopes.includes(scope) || agent.scopes.includes('*')
}

export function scopeGuard(agent: AuthenticatedAgent, scope: string): NextResponse | null {
  if (!requireScope(agent, scope)) {
    return NextResponse.json({ error: `Missing scope: ${scope}` }, { status: 403 })
  }
  return null
}
