import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { NextRequest } from "next/server";
import { projectOutlookAuthorization } from "@/core/channels/email/index.ts";
import { encryptCredentials } from "@/core/substrate/auth/index.ts";
import {
  appendPostgresEvent,
  type EventInput,
  type EventPayload,
  type PublishedEvent,
} from "@/core/substrate/events/index.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
} from "@/core/substrate/workflows/index.ts";
import { verifyState } from "../route.ts";
import { outlookConnectedRedirectPath } from "../destination.ts";
import { getRequestUserId } from "@/lib/auth";
import { hasWorkspaceAccess } from "@/lib/workspace";

/**
 * Microsoft OAuth callback. Exchanges the auth code for tokens, encrypts the
 * credentials, and emits typed authorization ingress. A projector creates
 * the account row and starts durable Graph-subscription repair after state
 * exists.
 *
 *   GET /api/auth/outlook/callback?code=<x>&state=<signed>
 *   GET /api/auth/microsoft-mail/callback?code=<x>&state=<signed>
 *
 * On success, redirects to the in-app Deliverability surface with the
 * channel_account_id so the user lands on an existing channel-health view while
 * the durable subscription repair workflow finishes.
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
  const userId = await getRequestUserId();
  if (
    !userId ||
    userId !== state.user_id ||
    !(await hasWorkspaceAccess(state.workspace_id, userId))
  ) {
    return new Response("workspace access denied", { status: 403 });
  }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new Response("MICROSOFT_CLIENT_{ID,SECRET} not set", { status: 500 });
  }
  const redirectUri = callbackRedirectUri(req, state);

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES,
  });
  let tokenResp: Response;
  try {
    tokenResp = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });
  } catch (err) {
    console.error("[auth/outlook/callback] token request failed", err);
    return outlookErrorRedirect(req);
  }
  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    return new Response(`token exchange failed: ${text.slice(0, 300)}`, {
      status: 502,
    });
  }
  let tokens: TokenResponse;
  try {
    tokens = (await tokenResp.json()) as TokenResponse;
  } catch (err) {
    console.error("[auth/outlook/callback] token response parse failed", err);
    return outlookErrorRedirect(req);
  }

  let meResp: Response;
  try {
    meResp = await fetch(ME_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
  } catch (err) {
    console.error("[auth/outlook/callback] profile request failed", err);
    return outlookErrorRedirect(req);
  }
  if (!meResp.ok) {
    return new Response("failed to load /me", { status: 502 });
  }
  let me: GraphMe;
  try {
    me = (await meResp.json()) as GraphMe;
  } catch (err) {
    console.error("[auth/outlook/callback] profile response parse failed", err);
    return outlookErrorRedirect(req);
  }

  try {
    const email = me.mail ?? me.userPrincipalName ?? me.displayName ?? "outlook";
    const pool = getPool();
    const channelAccountId = randomUUID();
    const credentials = encryptCredentials(
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      },
      {
        workspace_id: state.workspace_id,
        channel_account_id: channelAccountId,
      },
    );

    const authorizationEvent = await appendIngressEvent(pool, {
      workspace_id: state.workspace_id,
      event_type: "email.outlook.authorization.received",
      source: "user",
      producer_ref: `user:${userId}`,
      idempotency_key: `outlook-authorization:${channelAccountId}`,
      payload: {
        channel_account_id: channelAccountId,
        display_name: email,
        daily_cap: Number(process.env.OUTLOOK_DEFAULT_DAILY_CAP ?? 25),
        encrypted_credentials: credentials,
        ms_user_id: me.id,
      },
    });
    await projectOutlookAuthorization(
      pool,
      state.workspace_id,
      authorizationEvent.payload as EventPayload<"email.outlook.authorization.received">,
    );
    await appendIngressEvent(pool, {
      workspace_id: state.workspace_id,
      event_type: "channel.account.connected",
      source: "system",
      producer_ref: "projection:email.outlook.authorization.received",
      causation_id: authorizationEvent.id,
      correlation_id: authorizationEvent.correlation_id ?? authorizationEvent.id,
      idempotency_key: `projection:${authorizationEvent.id}:channel.account.connected`,
      payload: {
        channel_account_id: channelAccountId,
        kind: "oauth_outlook",
        account_display_name: email,
        provider_account_id: me.id,
      },
    });
    await startOutlookSubscriptionRepair(state.workspace_id, channelAccountId);

    const dest = new URL(outlookConnectedRedirectPath(channelAccountId), appOrigin(req));
    return Response.redirect(dest.toString(), 302);
  } catch (err) {
    console.error("[auth/outlook/callback] completion failed", err);
    return outlookErrorRedirect(req);
  }
}

async function appendIngressEvent(
  pool: Pool,
  input: EventInput,
): Promise<PublishedEvent> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const event = await appendPostgresEvent(client, input);
    await enqueueNatsDispatch(client, event);
    await client.query("commit");
    return event;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function enqueueNatsDispatch(
  client: PoolClient,
  event: PublishedEvent,
): Promise<void> {
  await client.query(
    `insert into event_nats_dispatches (event_id, workspace_id)
     values ($1, $2)
     on conflict (event_id) do nothing`,
    [event.id, event.workspace_id],
  );
}

async function startOutlookSubscriptionRepair(
  workspace_id: string,
  channel_account_id: string,
): Promise<void> {
  const ingressUrl = process.env.RESTATE_INGRESS_URL?.trim();
  if (!ingressUrl) return;
  try {
    const runtime = createRestateWorkflowRuntime({
      ingressUrl,
      bearer: restateBearerFromEnv(),
    });
    await runtime.start({
      workspace_id,
      workflow_name: "email_outlook_subscription_repair",
      idempotency_key: `outlook-subscription-bootstrap:${channel_account_id}`,
      input: { workspace_id, channel_account_id },
    });
  } catch (err) {
    console.error("[auth/outlook/callback] subscription repair start failed", err);
  }
}

function appOrigin(req: NextRequest): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

function callbackRedirectUri(
  req: NextRequest,
  state: { redirect_uri?: string },
): string {
  const stateRedirectUri = state.redirect_uri?.trim();
  return (
    stateRedirectUri ||
    process.env.MICROSOFT_REDIRECT_URI ||
    `${appOrigin(req)}/api/auth/outlook/callback`
  );
}

function outlookErrorRedirect(req: NextRequest): Response {
  const dest = new URL("/dashboard/deliverability", appOrigin(req));
  dest.searchParams.set("outlook", "error");
  dest.searchParams.set("reason", "callback");
  return Response.redirect(dest.toString(), 302);
}
