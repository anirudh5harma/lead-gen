import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createRuntimeEventBus } from "@/core/substrate/events/index.ts";
import {
  type OutlookNotificationBatch,
} from "@/core/channels/email/outlook-subscription.ts";
import {
  createLifecycleTokenValidator,
  extractLifecycleEvents,
  isLifecycleEnvelope,
  type LifecycleTokenValidator,
} from "@/core/channels/email/graph-lifecycle.ts";

/**
 * Microsoft Graph change-notification webhook.
 *
 *   GET ?validationToken=<x>
 *     → return the token as text/plain (Graph subscription handshake)
 *
 *   POST
 *     → body: { value: [ { subscriptionId, clientState, resource, resourceData: { id } } ],
 *                validationTokens?: [ "<JWS>" ] }
 *     → for change notifications: verify clientState + emit
 *       email.outlook.notification.received per resource.
 *     → for lifecycle notifications (reauthorizationRequired,
 *       subscriptionRemoved, missed): emit the appropriate typed event.
 *     → if validationTokens are present (always true once
 *       lifecycleNotificationUrl is wired), verify every token's
 *       Microsoft Entra signature + aud=MICROSOFT_CLIENT_ID before
 *       acting on the notification.
 *
 * We must return 2xx within 30s or Graph drops the subscription on
 * repeated failure. The route performs authentication, signature
 * verification, and durable enqueue only.
 */

export const dynamic = "force-dynamic";

// Lazy singleton so JWKS cache survives across invocations within a
// warm container. Multi-tenant deployments leave the validator with
// no tenantId; single-tenant set MICROSOFT_TENANT_ID.
let cachedValidator: LifecycleTokenValidator | null = null;
function getValidator(): LifecycleTokenValidator | null {
  if (cachedValidator) return cachedValidator;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) return null;
  cachedValidator = createLifecycleTokenValidator({
    clientId,
    tenantId: process.env.MICROSOFT_TENANT_ID || undefined,
  });
  return cachedValidator;
}

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
  // Echo validation tokens if present (handshake during subscription
  // create/lifecycle URL probe).
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

  // Signature validation: when Graph sends validationTokens we MUST
  // verify them before acting. Subscriptions created with a
  // lifecycleNotificationUrl get validationTokens on every callback.
  if (Array.isArray(body.validationTokens) && body.validationTokens.length > 0) {
    const validator = getValidator();
    if (!validator) {
      // Defence in depth: tokens present but we can't verify them. Refuse
      // — better Graph re-tries (and we log) than processing unverified data.
      return new Response("MICROSOFT_CLIENT_ID is not set for validation", {
        status: 500,
      });
    }
    const result = await validator.validate(body.validationTokens);
    if (!result.ok) {
      // Per Microsoft guidance we should still 2xx so Graph doesn't churn
      // the subscription on a transient signature mismatch, but we MUST
      // skip processing the payload.
      console.warn("[outlook webhook] validationTokens rejected:", result.error);
      return new Response(null, { status: 202 });
    }
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
    if (isLifecycleEnvelope(body)) {
      const events = extractLifecycleEvents(body);
      for (const e of events) {
        const located = await locateAccount(pool, e.subscriptionId, e.clientState);
        if (!located) continue;
        if (e.lifecycleEvent === "reauthorizationRequired") {
          await bus.publish({
            workspace_id: located.workspace_id,
            event_type: "email.outlook.reauthorization.required",
            source: "webhook",
            producer_ref: "webhook:outlook:graph:lifecycle",
            idempotency_key:
              `graph-lifecycle:${e.subscriptionId}:reauthorizationRequired`,
            payload: {
              channel_account_id: located.channel_account_id,
              error: "Microsoft Graph requires re-consent for this account.",
            },
          });
        } else {
          // subscriptionRemoved / missed / other: surface as a generic
          // channel-account-errored so the dashboard can show + repair.
          await bus.publish({
            workspace_id: located.workspace_id,
            event_type: "channel.account.errored",
            source: "webhook",
            producer_ref: "webhook:outlook:graph:lifecycle",
            idempotency_key:
              `graph-lifecycle:${e.subscriptionId}:${e.lifecycleEvent}`,
            payload: {
              channel_account_id: located.channel_account_id,
              kind: "oauth_outlook",
              error: `lifecycle event: ${e.lifecycleEvent}`,
            },
          });
        }
      }
      return new Response(null, { status: 202 });
    }

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
