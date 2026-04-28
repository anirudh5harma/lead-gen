import { createAdminClient } from '@/lib/supabase/server'
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  pkceS256,
  randomToken,
  safeRedirectUri,
  tokenHash,
} from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null)
  if (!form) return oauthError('invalid_request')

  const grantType = formValue(form, 'grant_type')
  const code = formValue(form, 'code')
  const redirectUri = formValue(form, 'redirect_uri')
  const clientId = formValue(form, 'client_id')
  const verifier = formValue(form, 'code_verifier')

  if (grantType !== 'authorization_code') return oauthError('unsupported_grant_type')
  if (!code || !redirectUri || !clientId || !verifier) return oauthError('invalid_request')
  if (!safeRedirectUri(redirectUri)) return oauthError('invalid_grant')

  const service = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data: codeRow, error } = await service
    .from('mcp_oauth_codes')
    .select('code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used_at')
    .eq('code_hash', tokenHash(code))
    .eq('client_id', clientId)
    .eq('redirect_uri', redirectUri)
    .gt('expires_at', nowIso)
    .maybeSingle()

  if (error || !codeRow || codeRow.used_at) return oauthError('invalid_grant')
  if (codeRow.code_challenge_method !== 'S256' || pkceS256(verifier) !== codeRow.code_challenge) {
    return oauthError('invalid_grant')
  }

  const accessToken = `mcp_${randomToken(32)}`
  const expiresAt = new Date(Date.now() + MCP_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
  const { error: markUsedError, count } = await service
    .from('mcp_oauth_codes')
    .update({ used_at: nowIso }, { count: 'exact' })
    .eq('code_hash', codeRow.code_hash)
    .is('used_at', null)

  if (markUsedError) return oauthError('server_error', 500)
  if (count !== 1) return oauthError('invalid_grant')

  const { error: tokenError } = await service
    .from('mcp_oauth_tokens')
    .insert({
      token_hash: tokenHash(accessToken),
      user_id: codeRow.user_id,
      client_id: codeRow.client_id,
      scope: codeRow.scope,
      expires_at: expiresAt,
    })

  if (tokenError) return oauthError('server_error', 500)

  return Response.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: MCP_ACCESS_TOKEN_TTL_SECONDS,
    scope: codeRow.scope ?? 'bombsell:read bombsell:write:safe',
  }, { headers: corsHeaders() })
}

function formValue(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function oauthError(error: string, status = 400): Response {
  return Response.json({ error }, { status, headers: corsHeaders() })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  }
}
