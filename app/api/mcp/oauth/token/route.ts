import { getPool } from "@/core/substrate/storage/index.ts";
import {
  MCP_ACCESS_TOKEN_TTL_SECONDS,
  pkceS256,
  randomToken,
  safeRedirectUri,
  tokenHash,
} from "@/core/mcp/oauth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  const body = await readTokenRequest(request);
  if (!body) {
    return oauthError("invalid_request", 400, "Token requests must be form-encoded or JSON.");
  }

  const suppliedClientId =
    body.client_id || clientIdFromBasicAuth(request.headers.get("authorization"));

  if (body.grant_type !== "authorization_code") {
    return oauthError("unsupported_grant_type");
  }
  if (!body.code || !body.code_verifier) {
    return oauthError("invalid_request", 400, "Missing code or code_verifier.");
  }
  if (body.redirect_uri && !safeRedirectUri(body.redirect_uri)) {
    return oauthError("invalid_grant", 400, "Invalid redirect_uri.");
  }

  const pool = getPool();
  const now = new Date();
  const { rows } = await pool.query<{
    code_hash: string;
    client_id: string;
    user_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    scope: string | null;
    used_at: Date | null;
  }>(
    `select code_hash, client_id, user_id, redirect_uri, code_challenge,
            code_challenge_method, scope, used_at
       from mcp_oauth_codes
      where code_hash = $1
        and expires_at > $2
      limit 1`,
    [tokenHash(body.code), now],
  );
  const codeRow = rows[0];
  if (!codeRow || codeRow.used_at) {
    return oauthError("invalid_grant", 400, "Authorization code is invalid, expired, or already used.");
  }

  const clientId = suppliedClientId || codeRow.client_id;
  if (clientId !== codeRow.client_id) {
    return oauthError("invalid_grant", 400, "Client does not match authorization code.");
  }

  const redirectUri = body.redirect_uri || codeRow.redirect_uri;
  if (safeRedirectUri(redirectUri) !== safeRedirectUri(codeRow.redirect_uri)) {
    return oauthError("invalid_grant", 400, "Redirect URI does not match authorization code.");
  }

  if (
    codeRow.code_challenge_method !== "S256" ||
    pkceS256(body.code_verifier) !== codeRow.code_challenge
  ) {
    return oauthError("invalid_grant", 400, "PKCE verifier does not match the authorization request.");
  }

  const { rows: usedRows } = await pool.query<{ code_hash: string }>(
    `update mcp_oauth_codes
        set used_at = $2
      where code_hash = $1
        and used_at is null
      returning code_hash`,
    [codeRow.code_hash, now],
  );
  if (!usedRows[0]) {
    return oauthError("invalid_grant", 400, "Authorization code is invalid, expired, or already used.");
  }

  const accessToken = `mcp_${randomToken(32)}`;
  const expiresAt = new Date(Date.now() + MCP_ACCESS_TOKEN_TTL_SECONDS * 1000);
  await pool.query(
    `insert into mcp_oauth_tokens
       (token_hash, user_id, client_id, scope, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [tokenHash(accessToken), codeRow.user_id, codeRow.client_id, codeRow.scope, expiresAt],
  );

  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: MCP_ACCESS_TOKEN_TTL_SECONDS,
      scope: codeRow.scope,
    },
    { headers: corsHeaders() },
  );
}

interface TokenRequestBody {
  grant_type: string;
  code: string;
  redirect_uri: string;
  client_id: string;
  code_verifier: string;
}

async function readTokenRequest(request: Request): Promise<TokenRequestBody | null> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const json = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!json) return null;
    return {
      grant_type: stringValue(json.grant_type),
      code: stringValue(json.code),
      redirect_uri: stringValue(json.redirect_uri),
      client_id: stringValue(json.client_id),
      code_verifier: stringValue(json.code_verifier),
    };
  }

  const text = await request.text().catch(() => "");
  if (!text.trim()) return null;
  const params = new URLSearchParams(text);
  return {
    grant_type: params.get("grant_type") ?? "",
    code: params.get("code") ?? "",
    redirect_uri: params.get("redirect_uri") ?? "",
    client_id: params.get("client_id") ?? "",
    code_verifier: params.get("code_verifier") ?? "",
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function clientIdFromBasicAuth(header: string | null): string {
  if (!header?.toLowerCase().startsWith("basic ")) return "";
  try {
    const decoded = Buffer.from(header.slice(header.indexOf(" ") + 1), "base64").toString("utf8");
    return decoded.split(":", 1)[0] ?? "";
  } catch {
    return "";
  }
}

function oauthError(error: string, status = 400, errorDescription?: string): Response {
  return Response.json(
    {
      error,
      ...(errorDescription ? { error_description: errorDescription } : {}),
    },
    { status, headers: corsHeaders() },
  );
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  };
}
