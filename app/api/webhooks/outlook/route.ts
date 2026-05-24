import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createPostgresEventBus } from "@/core/substrate/events/index.ts";
import {
  handleInboundEmail,
  createDeepSeekIntentClassifier,
} from "@/core/channels/email/index.ts";
import {
  fetchOutlookMessage,
  graphMessageToInbound,
  loadSubscription,
  type OutlookNotificationBatch,
} from "@/core/channels/email/outlook-subscription.ts";
import { createDeepSeekClientFromEnv } from "@/core/agents/llm/index.ts";

/**
 * Microsoft Graph change-notification webhook.
 *
 *   GET ?validationToken=<x>
 *     → return the token as text/plain (Graph subscription handshake)
 *
 *   POST
 *     → body: { value: [ { subscriptionId, clientState, resource, resourceData: { id } } ] }
 *     → for each: load the subscription record by clientState ↔ channel_account,
 *       fetch the message body via Graph, convert to InboundEmail, dispatch.
 *
 * We must return 2xx within 30s or Graph drops the subscription on repeated
 * failure. So this route does the minimum inline: fetch + dispatch. For a
 * production deployment this work should move into a workflow step.
 *
 * Auth note: the route relies on Graph's `clientState` echo to authenticate
 * the notification (we stored a random secret on subscription creation).
 * SIGNATURE-based verification (the validationTokens array on POSTs)
 * happens on subscriptions created with `lifecycleNotificationUrl` —
 * production should opt in.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (!validationToken) {
    return new Response("missing validationToken", { status: 400 });
  }
  return new Response(validationToken, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Echo validation tokens if present (lifecycle notifications).
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  let body: OutlookNotificationBatch;
  try {
    body = (await req.json()) as OutlookNotificationBatch;
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  if (!Array.isArray(body?.value)) {
    return new Response("missing notifications", { status: 400 });
  }

  const pool = getPool();
  const bus = await createPostgresEventBus({ pool });
  const classifier = createDeepSeekIntentClassifier({
    llm: createDeepSeekClientFromEnv(),
  });

  try {
    for (const n of body.value) {
      const located = await locateAccount(pool, n.subscriptionId, n.clientState);
      if (!located) {
        // Wrong clientState or unknown subscription → skip silently. Returning
        // 2xx keeps Graph happy; the alternative is subscription churn.
        continue;
      }
      const accessToken = located.access_token;
      if (!accessToken) continue;

      const resourceId = n.resourceData?.id;
      if (!resourceId) continue;

      const message = await fetchOutlookMessage({ accessToken, messageId: resourceId });
      const inbound = graphMessageToInbound(
        message,
        located.workspace_id,
        located.channel_account_id,
      );
      if (!inbound) continue;
      await handleInboundEmail({ pool, bus, classifier }, inbound);
    }
  } finally {
    await bus.close();
  }

  return new Response(null, { status: 202 });
}

interface LocatedAccount {
  workspace_id: string;
  channel_account_id: string;
  access_token: string | null;
}

async function locateAccount(
  pool: ReturnType<typeof getPool>,
  subscriptionId: string,
  clientState: string | undefined,
): Promise<LocatedAccount | null> {
  // Match against channel_accounts.properties.outlook_subscription.id +
  // verify clientState. Cheap because of GIN on properties (added below).
  const { rows } = await pool.query<{
    workspace_id: string;
    id: string;
    credentials: { access_token?: string } | null;
    properties: { outlook_subscription?: { id: string; clientState: string } } | null;
  }>(
    `select workspace_id, id, credentials, properties
       from channel_accounts
      where kind = 'oauth_outlook'
        and properties -> 'outlook_subscription' ->> 'id' = $1
      limit 1`,
    [subscriptionId],
  );
  const row = rows[0];
  if (!row) return null;
  const expected = row.properties?.outlook_subscription?.clientState;
  if (!expected || expected !== clientState) return null;
  // Refresh-token dance happens in the adapter; here we just hand the
  // current access_token to the message-fetch call. Outlook will return
  // 401 if it's stale; the route fails for that notification but the
  // user's send pipeline triggers a refresh on next outbound send.
  void loadSubscription;
  return {
    workspace_id: row.workspace_id,
    channel_account_id: row.id,
    access_token: row.credentials?.access_token ?? null,
  };
}
