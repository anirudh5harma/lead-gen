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
  const body = await readTokenRequest(request)
  if (!body) return oauthError('invalid_request', 400, 'Token requests must be form-encoded or JSON.')

  const grantType = body.grant_type
  const code = body.code
  const redirectUri = body.redirect_uri
  const clientId = body.client_id || clientIdFromBasicAuth(request.headers.get('authorization'))
  const verifier = body.code_verifier

  if (grantType !== 'authorization_code') return oauthError('unsupported_grant_type')
  if (!code || !redirectUri || !clientId || !verifier) {
    return oauthError('invalid_request', 400, 'Missing code, redirect_uri, client_id, or code_verifier.')
  }
  if (!safeRedirectUri(redirectUri)) return oauthError('invalid_grant', 400, 'Invalid redirect_uri.')

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

  if (error) {
    console.error('MCP OAuth code lookup failed', { clientId, error })
    return oauthError('server_error', 500)
  }
  if (!codeRow || codeRow.used_at) return oauthError('invalid_grant', 400, 'Authorization code is invalid, expired, or already used.')
  if (codeRow.code_challenge_method !== 'S256' || pkceS256(verifier) !== codeRow.code_challenge) {
    return oauthError('invalid_grant', 400, 'PKCE verifier does not match the authorization request.')
  }

  const accessToken = `mcp_${randomToken(32)}`
  const expiresAt = new Date(Date.now() + MCP_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
  const { data: usedCode, error: markUsedError } = await service
    .from('mcp_oauth_codes')
    .update({ used_at: nowIso }, { count: 'exact' })
    .select('code_hash')
    .eq('code_hash', codeRow.code_hash)
    .is('used_at', null)
    .maybeSingle()

  if (markUsedError) {
    console.error('MCP OAuth code consume failed', { clientId, error: markUsedError })
    return oauthError('server_error', 500)
  }
  if (!usedCode) return oauthError('invalid_grant', 400, 'Authorization code is invalid, expired, or already used.')

  const { error: tokenError } = await service
    .from('mcp_oauth_tokens')
    .insert({
      token_hash: tokenHash(accessToken),
      user_id: codeRow.user_id,
      client_id: codeRow.client_id,
      scope: codeRow.scope,
      expires_at: expiresAt,
    })

  if (tokenError) {
    console.error('MCP OAuth token insert failed', { clientId, userId: codeRow.user_id, error: tokenError })
    return oauthError('server_error', 500)
  }

  return Response.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: MCP_ACCESS_TOKEN_TTL_SECONDS,
    scope: codeRow.scope ?? 'bombsell:read bombsell:write:safe',
  }, { headers: corsHeaders() })
}

interface TokenRequestBody {
  grant_type: string
  code: string
  redirect_uri: string
  client_id: string
  code_verifier: string
}

async function readTokenRequest(request: Request): Promise<TokenRequestBody | null> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''

  if (contentType.includes('application/json')) {
    const json = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!json) return null
    return {
      grant_type: stringValue(json.grant_type),
      code: stringValue(json.code),
      redirect_uri: stringValue(json.redirect_uri),
      client_id: stringValue(json.client_id),
      code_verifier: stringValue(json.code_verifier),
    }
  }

  const form = await request.formData().catch(() => null)
  if (!form) return null
  return {
    grant_type: formValue(form, 'grant_type'),
    code: formValue(form, 'code'),
    redirect_uri: formValue(form, 'redirect_uri'),
    client_id: formValue(form, 'client_id'),
    code_verifier: formValue(form, 'code_verifier'),
  }
}

function formValue(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function clientIdFromBasicAuth(header: string | null): string {
  if (!header?.startsWith('Basic ')) return ''
  try {
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
    return decoded.split(':', 1)[0] ?? ''
  } catch {
    return ''
  }
}

function oauthError(error: string, status = 400, errorDescription?: string): Response {
  return Response.json({
    error,
    ...(errorDescription ? { error_description: errorDescription } : {}),
  }, { status, headers: corsHeaders() })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
  }
}
