import { appOrigin, authorizationServerMetadataUrl } from '@/lib/mcp-oauth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = appOrigin(request)
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [authorizationServerMetadataUrl(request)],
    bearer_methods_supported: ['header'],
    resource_documentation: `${origin}/dashboard?view=mcp`,
    scopes_supported: ['bombsell:read', 'bombsell:write:safe'],
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  })
}
