import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30
export const MCP_AUTH_CODE_TTL_SECONDS = 10 * 60

export function randomToken(byteLength = 32): string {
  return base64Url(randomBytes(byteLength))
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function pkceS256(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

export function safeRedirectUri(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return url.toString()
    if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return url.toString()
    return null
  } catch {
    return null
  }
}

export function normalizeRedirectUris(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map(safeRedirectUri).filter((value): value is string => Boolean(value)))].slice(0, 20)
}

export function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  const url = new URL(request.url)
  return url.origin
}

export function protectedResourceMetadataUrl(request: Request): string {
  return `${appOrigin(request)}/.well-known/oauth-protected-resource`
}

export function authorizationServerMetadataUrl(request: Request): string {
  return `${appOrigin(request)}/.well-known/oauth-authorization-server`
}

export async function validateMcpAccessToken(
  supabase: SupabaseClient,
  token: string,
): Promise<{ userId: string; clientId: string | null; scope: string | null } | null> {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('mcp_oauth_tokens')
    .select('user_id, client_id, scope, expires_at')
    .eq('token_hash', tokenHash(token))
    .gt('expires_at', nowIso)
    .maybeSingle()

  if (error || !data) return null

  await supabase
    .from('mcp_oauth_tokens')
    .update({ last_used_at: nowIso })
    .eq('token_hash', tokenHash(token))

  return {
    userId: data.user_id,
    clientId: data.client_id ?? null,
    scope: data.scope ?? null,
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
}

function base64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
