import { createAdminClient } from '@/lib/supabase/server'
import { normalizeRedirectUris, randomToken } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    client_name?: unknown
    redirect_uris?: unknown
    token_endpoint_auth_method?: unknown
  } | null

  const redirectUris = normalizeRedirectUris(body?.redirect_uris)
  if (redirectUris.length === 0) {
    return Response.json({ error: 'invalid_redirect_uri' }, { status: 400, headers: corsHeaders() })
  }

  const authMethod = body?.token_endpoint_auth_method === 'none' || !body?.token_endpoint_auth_method
    ? 'none'
    : null
  if (!authMethod) {
    return Response.json({ error: 'invalid_client_metadata' }, { status: 400, headers: corsHeaders() })
  }

  const clientId = `mcp_${randomToken(24)}`
  const clientName = typeof body?.client_name === 'string' ? body.client_name.slice(0, 120) : 'MCP client'

  const supabase = createAdminClient()
  const { error } = await supabase.from('mcp_oauth_clients').insert({
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: authMethod,
  })

  if (error) {
    return Response.json({ error: 'server_error' }, { status: 500, headers: corsHeaders() })
  }

  return Response.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: redirectUris,
    token_endpoint_auth_method: authMethod,
    grant_types: ['authorization_code'],
    response_types: ['code'],
  }, { status: 201, headers: corsHeaders() })
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
}
