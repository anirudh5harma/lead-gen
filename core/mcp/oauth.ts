import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { getPool } from "../substrate/storage/index.ts";
import { BOMBSELL_MCP_OAUTH_SCOPES } from "./oauth-metadata.ts";

export const MCP_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const MCP_AUTH_CODE_TTL_SECONDS = 10 * 60;

export interface McpAccessTokenClaims {
  userId: string;
  clientId: string | null;
  scope: string | null;
}

export function randomToken(byteLength = 32): string {
  return base64Url(randomBytes(byteLength));
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function pkceS256(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function safeRedirectUri(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function normalizeRedirectUris(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(safeRedirectUri).filter(Boolean) as string[])].slice(0, 20);
}

export function normalizeMcpScope(scope: string | null | undefined): string {
  const requested = (scope?.trim() ? scope : BOMBSELL_MCP_OAUTH_SCOPES.join(" "))
    .split(/\s+/)
    .filter(Boolean);
  const allowed = new Set<string>(BOMBSELL_MCP_OAUTH_SCOPES);
  return [...new Set(requested.filter((item) => allowed.has(item)))].join(" ");
}

export function hasOnlyKnownMcpScopes(scope: string | null | undefined): boolean {
  if (!scope?.trim()) return true;
  const allowed = new Set<string>(BOMBSELL_MCP_OAUTH_SCOPES);
  return scope.split(/\s+/).filter(Boolean).every((item) => allowed.has(item));
}

export async function validateMcpAccessToken(
  token: string,
  pool: Pool = getPool(),
): Promise<McpAccessTokenClaims | null> {
  const now = new Date();
  const { rows } = await pool.query<{
    user_id: string;
    client_id: string | null;
    scope: string | null;
  }>(
    `select user_id, client_id, scope
      from mcp_oauth_tokens
      where token_hash = $1
        and expires_at > $2
        and revoked_at is null
      limit 1`,
    [tokenHash(token), now],
  );
  const row = rows[0];
  if (!row) return null;

  await pool.query(
    `update mcp_oauth_tokens
        set last_used_at = $2
      where token_hash = $1`,
    [tokenHash(token), now],
  );

  return {
    userId: row.user_id,
    clientId: row.client_id,
    scope: row.scope,
  };
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

function base64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
