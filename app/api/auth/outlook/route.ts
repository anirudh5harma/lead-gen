import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getActiveWorkspaceSession } from "@/lib/workspace";

/**
 * Start the Microsoft OAuth flow. Redirects the user to Microsoft's
 * authorize endpoint with our client_id, the workspace context, and a
 * signed state token so the callback can verify the request came from us.
 *
 * Workspace context comes from the verified user's active membership,
 * never from caller-supplied query parameters.
 */

export const dynamic = "force-dynamic";

const AUTHORIZE = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const OUTLOOK_MAIL_AND_CALENDAR_SCOPES = [
  "offline_access",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.Read",
  "https://graph.microsoft.com/Calendars.ReadBasic",
  "https://graph.microsoft.com/User.Read",
] as const;

type OutlookAuthIntent = "mail" | "calendar";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getActiveWorkspaceSession();
  if (!session) return new Response("authentication required", { status: 401 });

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) return new Response("MICROSOFT_CLIENT_ID is not set", { status: 500 });
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI ??
    `${appOrigin(req)}/api/auth/outlook/callback`;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return new Response("SESSION_SECRET is not set", { status: 500 });

  const intent = outlookAuthIntent(req.nextUrl.searchParams.get("intent"));
  const returnTo = safeReturnTo(req.nextUrl.searchParams.get("return_to"));
  const state = signState(
    {
      workspace_id: session.workspace.id,
      user_id: session.user_id,
      redirect_uri: redirectUri,
      intent,
      ...(returnTo ? { return_to: returnTo } : {}),
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
  authorizeUrl.searchParams.set("scope", OUTLOOK_MAIL_AND_CALENDAR_SCOPES.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", intent === "calendar" ? "consent" : "select_account");

  return Response.redirect(authorizeUrl.toString(), 302);
}

interface OAuthState {
  workspace_id: string;
  user_id: string;
  redirect_uri?: string;
  intent?: OutlookAuthIntent;
  return_to?: string;
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
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(sig);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }
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

function outlookAuthIntent(value: string | null): OutlookAuthIntent {
  return value === "calendar" ? "calendar" : "mail";
}

function safeReturnTo(value: string | null): string | null {
  if (!value?.startsWith("/dashboard/")) return null;
  try {
    const parsed = new URL(value, "https://app.local");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
