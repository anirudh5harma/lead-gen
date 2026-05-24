import { randomBytes, createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Start the Microsoft OAuth flow. Redirects the user to Microsoft's
 * authorize endpoint with our client_id, the workspace context, and a
 * signed state token so the callback can verify the request came from us.
 *
 *   GET /api/auth/outlook?workspace_id=<uuid>
 *
 * Authentication note: this route ASSUMES the caller is already a
 * workspace member. A proper session layer hasn't landed in pivot-v2 yet
 * (legacy Supabase auth is archived). For dev and the demo, the workspace
 * id comes from the query string; production must replace this with a
 * server-side workspace lookup from the session.
 */

export const dynamic = "force-dynamic";

const AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const DEFAULT_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/User.Read",
];

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) return new Response("MICROSOFT_CLIENT_ID is not set", { status: 500 });
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI ??
    `${appOrigin(req)}/api/auth/outlook/callback`;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return new Response("SESSION_SECRET is not set", { status: 500 });

  const workspaceId = req.nextUrl.searchParams.get("workspace_id");
  if (!workspaceId) return new Response("workspace_id is required", { status: 400 });

  const state = signState(
    {
      workspace_id: workspaceId,
      nonce: randomBytes(12).toString("base64url"),
      iat: Date.now(),
    },
    sessionSecret,
  );

  const authorizeUrl = new URL(AUTHORIZE);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("scope", DEFAULT_SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "select_account");

  return Response.redirect(authorizeUrl.toString(), 302);
}

interface OAuthState {
  workspace_id: string;
  nonce: string;
  iat: number;
}

export function signState(state: OAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(token: string, secret: string): OAuthState | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (expected !== sig) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (Date.now() - parsed.iat > 10 * 60_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function appOrigin(req: NextRequest): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
