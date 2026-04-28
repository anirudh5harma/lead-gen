import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/server'
import { MCP_AUTH_CODE_TTL_SECONDS, randomToken, safeRedirectUri, tokenHash } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

interface AuthorizeParams {
  response_type: string
  client_id: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  state: string | null
  scope: string | null
}

export async function GET(request: Request) {
  const params = readAuthorizeParams(new URL(request.url).searchParams)
  const validation = await validateAuthorizeParams(params)
  if (!validation.ok) return validation.response

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const url = new URL(request.url)
    return NextResponse.redirect(`${url.origin}/?next=${encodeURIComponent(`${url.pathname}${url.search}`)}`)
  }

  return new Response(renderConsentPage(params, validation.clientName), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(request: Request) {
  const form = await request.formData()
  const params = readAuthorizeParams(form)
  const validation = await validateAuthorizeParams(params)
  if (!validation.ok) return validation.response

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const url = new URL(request.url)
    return NextResponse.redirect(`${url.origin}/?next=${encodeURIComponent(`${url.pathname}?${serializeAuthorizeParams(params)}`)}`)
  }

  const code = randomToken(32)
  const expiresAt = new Date(Date.now() + MCP_AUTH_CODE_TTL_SECONDS * 1000).toISOString()
  const service = createAdminClient()
  const { error } = await service.from('mcp_oauth_codes').insert({
    code_hash: tokenHash(code),
    client_id: params.client_id,
    user_id: user.id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    scope: normalizeScope(params.scope),
    expires_at: expiresAt,
  })

  if (error) {
    return Response.json({ error: 'server_error' }, { status: 500 })
  }

  const redirect = new URL(params.redirect_uri)
  redirect.searchParams.set('code', code)
  if (params.state) redirect.searchParams.set('state', params.state)
  return NextResponse.redirect(redirect.toString(), 303)
}

async function validateAuthorizeParams(params: AuthorizeParams): Promise<
  | { ok: true; clientName: string | null }
  | { ok: false; response: Response }
> {
  if (params.response_type !== 'code') {
    return { ok: false, response: oauthError(params.redirect_uri, params.state, 'unsupported_response_type') }
  }
  if (!params.client_id || !params.redirect_uri || !params.code_challenge) {
    return { ok: false, response: Response.json({ error: 'invalid_request' }, { status: 400 }) }
  }
  if (params.code_challenge_method !== 'S256') {
    return { ok: false, response: oauthError(params.redirect_uri, params.state, 'invalid_request') }
  }
  const redirectUri = safeRedirectUri(params.redirect_uri)
  if (!redirectUri || redirectUri !== params.redirect_uri) {
    return { ok: false, response: Response.json({ error: 'invalid_redirect_uri' }, { status: 400 }) }
  }

  const service = createAdminClient()
  const { data, error } = await service
    .from('mcp_oauth_clients')
    .select('client_name, redirect_uris')
    .eq('client_id', params.client_id)
    .maybeSingle()

  if (error || !data) {
    return { ok: false, response: Response.json({ error: 'invalid_client' }, { status: 400 }) }
  }

  const redirectUris = Array.isArray(data.redirect_uris) ? data.redirect_uris as string[] : []
  if (!redirectUris.includes(params.redirect_uri)) {
    return { ok: false, response: Response.json({ error: 'invalid_redirect_uri' }, { status: 400 }) }
  }

  return {
    ok: true,
    clientName: data.client_name ?? null,
  }
}

function readAuthorizeParams(source: URLSearchParams | FormData): AuthorizeParams {
  const get = (key: string) => {
    const value = source.get(key)
    return typeof value === 'string' ? value : ''
  }
  return {
    response_type: get('response_type'),
    client_id: get('client_id'),
    redirect_uri: get('redirect_uri'),
    code_challenge: get('code_challenge'),
    code_challenge_method: get('code_challenge_method') || 'plain',
    state: get('state') || null,
    scope: get('scope') || null,
  }
}

function serializeAuthorizeParams(params: AuthorizeParams): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return search.toString()
}

function oauthError(redirectUri: string, state: string | null, error: string): Response {
  const safe = safeRedirectUri(redirectUri)
  if (!safe) return Response.json({ error }, { status: 400 })
  const redirect = new URL(safe)
  redirect.searchParams.set('error', error)
  if (state) redirect.searchParams.set('state', state)
  return NextResponse.redirect(redirect.toString())
}

function normalizeScope(scope: string | null): string {
  const allowed = new Set(['bombsell:read', 'bombsell:write:safe'])
  const scopes = (scope ?? 'bombsell:read bombsell:write:safe')
    .split(/\s+/)
    .filter(item => allowed.has(item))
  return scopes.length ? [...new Set(scopes)].join(' ') : 'bombsell:read bombsell:write:safe'
}

function renderConsentPage(params: AuthorizeParams, clientName: string | null): string {
  const hidden = Object.entries(params)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}" />`)
    .join('\n')

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize Bombsell MCP</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f3ea; color: #171717; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(92vw, 520px); background: white; border: 1px solid #e7dece; border-radius: 28px; box-shadow: 0 30px 80px rgba(20, 24, 32, .14); padding: 32px; }
      .eyebrow { display: inline-flex; border: 1px solid #dbe7ff; color: #265fd8; background: #f2f6ff; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 18px 0 8px; font-size: 28px; line-height: 1.05; letter-spacing: -.03em; }
      p { color: #64615c; line-height: 1.6; font-size: 14px; }
      ul { margin: 20px 0; padding: 0; list-style: none; display: grid; gap: 10px; }
      li { background: #faf8f3; border: 1px solid #eee7da; border-radius: 16px; padding: 12px; font-size: 13px; color: #36332f; }
      button { width: 100%; height: 46px; border: 0; border-radius: 999px; background: #111827; color: white; font-weight: 700; cursor: pointer; }
      .muted { font-size: 12px; color: #8a857d; }
    </style>
  </head>
  <body>
    <main>
      <span class="eyebrow">Bombsell MCP</span>
      <h1>Connect ${escapeHtml(clientName || 'this agent client')}?</h1>
      <p>This lets the client read your Bombsell GTM context and use safe workflow actions.</p>
      <ul>
        <li>Read workspace ICP, leads, watchlist, feed sessions, and signal timelines.</li>
        <li>Update lead status and add watchlist companies.</li>
        <li>No email sending, lead unlocking, enrichment, or credit-burning actions.</li>
      </ul>
      <form method="post">
        ${hidden}
        <button type="submit">Authorize MCP access</button>
      </form>
      <p class="muted">You can revoke access by rotating MCP tokens or deleting OAuth tokens from your admin database.</p>
    </main>
  </body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
