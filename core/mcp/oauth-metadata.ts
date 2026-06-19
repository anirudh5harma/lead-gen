export const BOMBSELL_MCP_OAUTH_SCOPES = [
  "brief:read",
  "profile:read",
  "signals:read",
  "outreach:read",
  "outreach:prepare",
  "approvals:read",
  "approvals:write",
  "learning:read",
] as const;

export function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

export function protectedResourceMetadataUrl(request: Request): string {
  return `${appOrigin(request)}/.well-known/oauth-protected-resource`;
}

export function authorizationServerMetadataUrl(request: Request): string {
  return `${appOrigin(request)}/.well-known/oauth-authorization-server`;
}

export function mcpProtectedResourceMetadata(request: Request) {
  const origin = appOrigin(request);
  return {
    resource: `${origin}/api/mcp`,
    resource_name: "Bombsell MCP",
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: [...BOMBSELL_MCP_OAUTH_SCOPES],
    mcp_endpoint: `${origin}/api/mcp`,
  };
}

export function mcpAuthorizationServerMetadata(request: Request) {
  const origin = appOrigin(request);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...BOMBSELL_MCP_OAUTH_SCOPES],
    service_documentation: `${origin}/dashboard/profile#integrations`,
  };
}
