import { appOrigin } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = appOrigin(request)
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['bombsell:read', 'bombsell:write:safe'],
    service_documentation: `${origin}/dashboard?view=mcp`,
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  })
}
