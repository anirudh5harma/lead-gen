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
  if (!body) {
    logTokenFailure('unreadable_body', request, {})
    return oauthError('invalid_request', 400, 'Token requests must be form-encoded or JSON.')
  }

  const grantType = body.grant_type
  const code = body.code
  const suppliedRedirectUri = body.redirect_uri
  const suppliedClientId = body.client_id || clientIdFromBasicAuth(request.headers.get('authorization'))
  const verifier = body.code_verifier

  if (grantType !== 'authorization_code') {
    logTokenFailure('unsupported_grant_type', request, { grantType })
    return oauthError('unsupported_grant_type')
  }
  if (!code || !verifier) {
    logTokenFailure('missing_code_or_verifier', request, {
      hasCode: Boolean(code),
      hasVerifier: Boolean(verifier),
      hasClientId: Boolean(suppliedClientId),
      hasRedirectUri: Boolean(suppliedRedirectUri),
    })
    return oauthError('invalid_request', 400, 'Missing code or code_verifier.')
  }
  if (suppliedRedirectUri && !safeRedirectUri(suppliedRedirectUri)) {
    logTokenFailure('invalid_redirect_uri', request, { hasClientId: Boolean(suppliedClientId) })
    return oauthError('invalid_grant', 400, 'Invalid redirect_uri.')
  }

  const service = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data: codeRow, error } = await service
    .from('mcp_oauth_codes')
    .select('code_hash, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scope, expires_at, used_at')
    .eq('code_hash', tokenHash(code))
    .gt('expires_at', nowIso)
    .maybeSingle()

  if (error) {
    console.error('MCP OAuth code lookup failed', { clientId: suppliedClientId || null, error })
    return oauthError('server_error', 500)
  }
  if (!codeRow || codeRow.used_at) {
    logTokenFailure('invalid_or_used_code', request, {
      hasCodeRow: Boolean(codeRow),
      used: Boolean(codeRow?.used_at),
      hasClientId: Boolean(suppliedClientId),
      hasRedirectUri: Boolean(suppliedRedirectUri),
    })
    return oauthError('invalid_grant', 400, 'Authorization code is invalid, expired, or already used.')
  }

  const clientId = suppliedClientId || codeRow.client_id
  if (clientId !== codeRow.client_id) {
    logTokenFailure('client_mismatch', request, {
      suppliedClientId: maskClientId(suppliedClientId),
      codeClientId: maskClientId(codeRow.client_id),
    })
    return oauthError('invalid_grant', 400, 'Client does not match authorization code.')
  }

  const redirectUri = suppliedRedirectUri || codeRow.redirect_uri
  if (safeRedirectUri(redirectUri) !== safeRedirectUri(codeRow.redirect_uri)) {
    logTokenFailure('redirect_mismatch', request, {
      clientId: maskClientId(clientId),
      hasRedirectUri: Boolean(suppliedRedirectUri),
    })
    return oauthError('invalid_grant', 400, 'Redirect URI does not match authorization code.')
  }

  if (codeRow.code_challenge_method !== 'S256' || pkceS256(verifier) !== codeRow.code_challenge) {
    logTokenFailure('pkce_mismatch', request, { clientId: maskClientId(clientId) })
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
  if (!usedCode) {
    logTokenFailure('consume_race', request, { clientId: maskClientId(clientId) })
    return oauthError('invalid_grant', 400, 'Authorization code is invalid, expired, or already used.')
  }

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

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text().catch(() => '')
    return tokenBodyFromUrlEncoded(text)
  }

  if (!contentType) {
    const text = await request.text().catch(() => '')
    return tokenBodyFromUrlEncoded(text)
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

function tokenBodyFromUrlEncoded(text: string): TokenRequestBody | null {
  if (!text.trim()) return null
  const params = new URLSearchParams(text)
  return {
    grant_type: params.get('grant_type') ?? '',
    code: params.get('code') ?? '',
    redirect_uri: params.get('redirect_uri') ?? '',
    client_id: params.get('client_id') ?? '',
    code_verifier: params.get('code_verifier') ?? '',
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
  if (!header?.toLowerCase().startsWith('basic ')) return ''
  try {
    const decoded = Buffer.from(header.slice(header.indexOf(' ') + 1), 'base64').toString('utf8')
    return decoded.split(':', 1)[0] ?? ''
  } catch {
    return ''
  }
}

function logTokenFailure(reason: string, request: Request, details: Record<string, unknown>) {
  console.error('MCP OAuth token exchange rejected', {
    reason,
    contentType: request.headers.get('content-type') ?? null,
    userAgent: request.headers.get('user-agent') ?? null,
    ...details,
  })
}

function maskClientId(clientId: string | null | undefined): string | null {
  if (!clientId) return null
  return `${clientId.slice(0, 10)}...${clientId.slice(-6)}`
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
