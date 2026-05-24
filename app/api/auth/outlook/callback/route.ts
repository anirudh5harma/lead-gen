import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createOutlookSubscription } from "@/core/channels/email/outlook-subscription.ts";
import { verifyState } from "../route.ts";

/**
 * Microsoft OAuth callback. Exchanges the auth code for tokens, stores
 * them on a new `channel_accounts` row of kind 'oauth_outlook', and
 * creates the Graph subscription so inbound replies start flowing.
 *
 *   GET /api/auth/outlook/callback?code=<x>&state=<signed>
 *
 * On success, redirects to /onboarding/outlook?status=connected with the
 * channel_account_id. Production should redirect to the in-app
 * integrations view; for foundation the path is a placeholder the UI
 * shell will hook up.
 */

export const dynamic = "force-dynamic";

const TOKEN_ENDPOINT =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ME_ENDPOINT = "https://graph.microsoft.com/v1.0/me";
const DEFAULT_SCOPES =
  "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GraphMe {
  id: string;
  userPrincipalName?: string;
  mail?: string;
  displayName?: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return new Response(`OAuth error: ${oauthError}`, { status: 400 });
  }
  if (!code || !stateToken) {
    return new Response("missing code or state", { status: 400 });
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    return new Response("SESSION_SECRET is not set", { status: 500 });
  }
  const state = verifyState(stateToken, sessionSecret);
  if (!state) {
    return new Response("invalid or expired state", { status: 400 });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response("MICROSOFT_CLIENT_{ID,SECRET} not set", { status: 500 });
  }
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI ??
    `${appOrigin(req)}/api/auth/outlook/callback`;

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES,
  });
  const tokenResp = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString(),
  });
  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    return new Response(`token exchange failed: ${text.slice(0, 300)}`, {
      status: 502,
    });
  }
  const tokens = (await tokenResp.json()) as TokenResponse;

  const meResp = await fetch(ME_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!meResp.ok) {
    return new Response("failed to load /me", { status: 502 });
  }
  const me = (await meResp.json()) as GraphMe;
  const email = me.mail ?? me.userPrincipalName ?? me.displayName ?? "outlook";

  const pool = getPool();
  const channelAccountId = randomUUID();
  await pool.query(
    `insert into channel_accounts (
        id, workspace_id, kind, display_name, status,
        daily_cap, credentials, properties
      ) values (
        $1, $2, 'oauth_outlook', $3, 'connected',
        $4, $5::jsonb, $6::jsonb
      )`,
    [
      channelAccountId,
      state.workspace_id,
      email,
      Number(process.env.OUTLOOK_DEFAULT_DAILY_CAP ?? 25),
      JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      }),
      JSON.stringify({ ms_user_id: me.id }),
    ],
  );

  // Stand up the Graph subscription so inbound replies flow to the webhook.
  const notificationUrl = `${appOrigin(req)}/api/webhooks/outlook`;
  try {
    await createOutlookSubscription({
      pool,
      workspaceId: state.workspace_id,
      channelAccountId,
      accessToken: tokens.access_token,
      notificationUrl,
    });
  } catch (err) {
    // Best-effort: the account is connected even if the subscription
    // failed (transient Graph issues happen). The renewal cron will pick
    // it up next time.
    console.error("[outlook callback] subscription create failed:", err);
  }

  const dest = new URL(
    `/onboarding/outlook?status=connected&channel_account_id=${channelAccountId}`,
    appOrigin(req),
  );
  return Response.redirect(dest.toString(), 302);
}

function appOrigin(req: NextRequest): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
