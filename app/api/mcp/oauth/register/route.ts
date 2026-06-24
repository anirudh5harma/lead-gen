import { getPool } from "@/core/substrate/storage/index.ts";
import { normalizeRedirectUris, randomToken } from "@/core/mcp/oauth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REGISTER_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_REGISTRATION_LIMIT_PER_HOUR = 120;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (new TextEncoder().encode(raw).byteLength > MAX_REGISTER_PAYLOAD_BYTES) {
    return oauthError("payload_too_large", 413);
  }
  let body: {
    client_name?: unknown;
    redirect_uris?: unknown;
    token_endpoint_auth_method?: unknown;
  } | null;
  try {
    body = raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return oauthError("invalid_request", 400);
  }

  const redirectUris = normalizeRedirectUris(body?.redirect_uris);
  if (redirectUris.length === 0) {
    return oauthError("invalid_redirect_uri", 400);
  }

  const authMethod =
    body?.token_endpoint_auth_method === "none" || !body?.token_endpoint_auth_method
      ? "none"
      : null;
  if (!authMethod) return oauthError("invalid_client_metadata", 400);

  const clientId = `mcp_${randomToken(24)}`;
  const clientName =
    typeof body?.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : "MCP client";

  const pool = getPool();
  if (await registrationLimitReached(pool)) {
    return oauthError("rate_limited", 429);
  }

  await pool.query(
    `insert into mcp_oauth_clients
       (client_id, client_name, redirect_uris, token_endpoint_auth_method)
     values ($1, $2, $3, $4)`,
    [clientId, clientName, redirectUris, authMethod],
  );

  return Response.json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: authMethod,
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201, headers: corsHeaders() },
  );
}

function oauthError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: corsHeaders() });
}

async function registrationLimitReached(
  pool: ReturnType<typeof getPool>,
): Promise<boolean> {
  const limit = positiveIntegerEnv(
    "MCP_OAUTH_REGISTRATION_LIMIT_PER_HOUR",
    DEFAULT_REGISTRATION_LIMIT_PER_HOUR,
  );
  const { rows } = await pool.query<{ count: string }>(
    `select count(*)::text as count
       from mcp_oauth_clients
      where created_at >= now() - interval '1 hour'`,
  );
  return Number(rows[0]?.count ?? 0) >= limit;
}

function positiveIntegerEnv(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
}
