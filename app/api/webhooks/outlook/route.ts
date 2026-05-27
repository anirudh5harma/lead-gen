import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createRuntimeEventBus } from "@/core/substrate/events/index.ts";
import {
  type OutlookNotificationBatch,
} from "@/core/channels/email/outlook-subscription.ts";

/**
 * Microsoft Graph change-notification webhook.
 *
 *   GET ?validationToken=<x>
 *     → return the token as text/plain (Graph subscription handshake)
 *
 *   POST
 *     → body: { value: [ { subscriptionId, clientState, resource, resourceData: { id } } ] }
 *     → for each: verify clientState against the channel account and emit
 *       email.outlook.notification.received for a projector consumer.
 *
 * We must return 2xx within 30s or Graph drops the subscription on repeated
 * failure. The route performs authentication and durable enqueue only.
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
  let bus: Awaited<ReturnType<typeof createRuntimeEventBus>>;
  try {
    bus = await createRuntimeEventBus({ pool });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "event bus unavailable", {
      status: 503,
    });
  }

  try {
    for (const n of body.value) {
      const located = await locateAccount(pool, n.subscriptionId, n.clientState);
      if (!located) {
        // Wrong clientState or unknown subscription → skip silently. Returning
        // 2xx keeps Graph happy; the alternative is subscription churn.
        continue;
      }
      const resourceId = n.resourceData?.id;
      if (!resourceId) continue;

      await bus.publish({
        workspace_id: located.workspace_id,
        event_type: "email.outlook.notification.received",
        source: "webhook",
        producer_ref: "webhook:outlook:graph",
        idempotency_key: `graph:${n.subscriptionId}:${resourceId}`,
        payload: {
          channel_account_id: located.channel_account_id,
          subscription_id: n.subscriptionId,
          resource_id: resourceId,
        },
      });
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "enqueue failed", {
      status: 503,
    });
  } finally {
    await bus.close();
  }

  return new Response(null, { status: 202 });
}

interface LocatedAccount {
  workspace_id: string;
  channel_account_id: string;
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
    properties: { outlook_subscription?: { id: string; clientState: string } } | null;
  }>(
    `select workspace_id, id, properties
       from channel_accounts
      where kind = 'oauth_outlook'
        and properties -> 'outlook_subscription' ->> 'id' = $1
      limit 1`,
    [subscriptionId],
  );
  const row = rows[0];
  if (!row) return null;
  const expected = row.properties?.outlook_subscription?.clientState;
  if (!expected || !clientState || !secretEquals(expected, clientState)) return null;
  return {
    workspace_id: row.workspace_id,
    channel_account_id: row.id,
  };
}

function secretEquals(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
