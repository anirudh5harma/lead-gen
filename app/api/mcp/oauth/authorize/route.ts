import { NextResponse } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import {
  MCP_AUTH_CODE_TTL_SECONDS,
  hasOnlyKnownMcpScopes,
  normalizeMcpScope,
  randomToken,
  safeRedirectUri,
  tokenHash,
} from "@/core/mcp/oauth.ts";
import { getRequestAuthIdentity } from "@/lib/auth";
import { googleAuthPath } from "@/lib/auth/next";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  state: string | null;
  scope: string | null;
}

export async function GET(request: Request) {
  const params = readAuthorizeParams(new URL(request.url).searchParams);
  const validation = await validateAuthorizeParams(params);
  if (!validation.ok) return validation.response;

  const identity = await getRequestAuthIdentity();
  if (!identity) return redirectToGoogle(request, params);

  return new Response(renderConsentPage(params, validation.clientName), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const params = readAuthorizeParams(form);
  const validation = await validateAuthorizeParams(params);
  if (!validation.ok) return validation.response;

  const identity = await getRequestAuthIdentity();
  if (!identity) return redirectToGoogle(request, params);

  const code = randomToken(32);
  const expiresAt = new Date(Date.now() + MCP_AUTH_CODE_TTL_SECONDS * 1000);
  await getPool().query(
    `insert into mcp_oauth_codes
       (code_hash, client_id, user_id, redirect_uri, code_challenge,
        code_challenge_method, scope, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      tokenHash(code),
      params.client_id,
      identity.id,
      params.redirect_uri,
      params.code_challenge,
      params.code_challenge_method,
      normalizeMcpScope(params.scope),
      expiresAt,
    ],
  );

  const redirect = new URL(params.redirect_uri);
  redirect.searchParams.set("code", code);
  if (params.state) redirect.searchParams.set("state", params.state);
  return NextResponse.redirect(redirect.toString(), 303);
}

async function validateAuthorizeParams(params: AuthorizeParams): Promise<
  | { ok: true; clientName: string | null }
  | { ok: false; response: Response }
> {
  if (params.response_type !== "code") {
    return { ok: false, response: oauthError(params.redirect_uri, params.state, "unsupported_response_type") };
  }
  if (!params.client_id || !params.redirect_uri || !params.code_challenge) {
    return { ok: false, response: Response.json({ error: "invalid_request" }, { status: 400 }) };
  }
  if (params.code_challenge_method !== "S256") {
    return { ok: false, response: oauthError(params.redirect_uri, params.state, "invalid_request") };
  }
  if (!hasOnlyKnownMcpScopes(params.scope)) {
    return { ok: false, response: oauthError(params.redirect_uri, params.state, "invalid_scope") };
  }
  const redirectUri = safeRedirectUri(params.redirect_uri);
  if (!redirectUri || redirectUri !== params.redirect_uri) {
    return { ok: false, response: Response.json({ error: "invalid_redirect_uri" }, { status: 400 }) };
  }

  const { rows } = await getPool().query<{
    client_name: string | null;
    redirect_uris: string[];
  }>(
    `select client_name, redirect_uris
       from mcp_oauth_clients
      where client_id = $1
      limit 1`,
    [params.client_id],
  );
  const client = rows[0];
  if (!client) {
    return { ok: false, response: Response.json({ error: "invalid_client" }, { status: 400 }) };
  }
  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return { ok: false, response: Response.json({ error: "invalid_redirect_uri" }, { status: 400 }) };
  }

  return { ok: true, clientName: client.client_name };
}

function readAuthorizeParams(source: URLSearchParams | FormData): AuthorizeParams {
  const get = (key: string) => {
    const value = source.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    response_type: get("response_type"),
    client_id: get("client_id"),
    redirect_uri: get("redirect_uri"),
    code_challenge: get("code_challenge"),
    code_challenge_method: get("code_challenge_method") || "plain",
    state: get("state") || null,
    scope: get("scope") || null,
  };
}

function redirectToGoogle(request: Request, params: AuthorizeParams): Response {
  const url = new URL(request.url);
  const next = `${url.pathname}?${serializeAuthorizeParams(params)}`;
  return NextResponse.redirect(new URL(googleAuthPath(next), request.url));
}

function serializeAuthorizeParams(params: AuthorizeParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

function oauthError(redirectUri: string, state: string | null, error: string): Response {
  const safe = safeRedirectUri(redirectUri);
  if (!safe) return Response.json({ error }, { status: 400 });
  const redirect = new URL(safe);
  redirect.searchParams.set("error", error);
  if (state) redirect.searchParams.set("state", state);
  return NextResponse.redirect(redirect.toString());
}

function renderConsentPage(params: AuthorizeParams, clientName: string | null): string {
  const hidden = Object.entries(params)
    .filter(([, value]) => value !== null)
    .map(([key, value]) =>
      `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(String(value))}" />`
    )
    .join("\n");
  const scopeLabels = normalizeMcpScope(params.scope)
    .split(/\s+/)
    .filter(Boolean)
    .map((scope) => `<li>${escapeHtml(labelForScope(scope))}</li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize Bombsell MCP</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #08090b; color: #f4f4f5; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #08090b; }
      main { width: min(100%, 520px); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; background: #101216; padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.42); }
      .kicker { color: #79d7be; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 12px 0 10px; font-size: 28px; line-height: 1.1; }
      p { margin: 0; color: #a1a1aa; line-height: 1.6; }
      ul { margin: 20px 0; padding: 0; list-style: none; display: grid; gap: 10px; }
      li { border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: #171a20; padding: 12px; color: #e4e4e7; font-size: 14px; }
      button { width: 100%; min-height: 44px; border: 0; border-radius: 8px; background: #f4f4f5; color: #08090b; font-weight: 700; cursor: pointer; }
      .muted { margin-top: 14px; font-size: 12px; color: #71717a; }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">Bombsell MCP</p>
      <h1>Connect ${escapeHtml(clientName || "this agent client")}?</h1>
      <p>This lets the client use your Bombsell workspace from Claude Code or another MCP host.</p>
      <ul>${scopeLabels}</ul>
      <form method="post">
        ${hidden}
        <button type="submit">Authorize access</button>
      </form>
      <p class="muted">Bombsell never grants send access without the workspace approval and eval gates exposed by the product.</p>
    </main>
  </body>
</html>`;
}

function labelForScope(scope: string): string {
  switch (scope) {
    case "brief:read":
      return "Read your brief and dashboard metrics.";
    case "profile:read":
      return "Read profile and integration readiness.";
    case "signals:read":
      return "Read qualified buying signals and verified contact lanes.";
    case "outreach:read":
      return "Read sent email and LinkedIn outreach.";
    case "outreach:prepare":
      return "Prepare outreach drafts for review.";
    case "crm:write":
      return "Queue CRM handoff packages with proof.";
    case "approvals:read":
      return "Read pending approvals.";
    case "approvals:write":
      return "Approve or reject gated workflow steps.";
    case "learning:read":
      return "Read reply, meeting, and learning insights.";
    default:
      return scope;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
