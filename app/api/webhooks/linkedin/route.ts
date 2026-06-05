import type { NextRequest } from "next/server";
import {
  LinkedInProviderWebhook,
  type LinkedInProviderWebhookPayload,
  lifecycleIdempotencyKey,
  providerErrorMessage,
  providerStatus,
  verifyLinkedInProviderSignature,
} from "@/core/channels/linkedin/index.ts";
import { createJournaledDispatchEventBus } from "@/core/substrate/events/index.ts";
import { getPool } from "@/core/substrate/storage/index.ts";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.LINKEDIN_PROVIDER_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("LINKEDIN_PROVIDER_WEBHOOK_SECRET is not set", {
      status: 500,
    });
  }

  const rawBody = await req.text();
  if (
    !verifyLinkedInProviderSignature(
      rawBody,
      req.headers.get("x-linkedin-provider-signature"),
      secret,
    )
  ) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: LinkedInProviderWebhookPayload;
  try {
    payload = LinkedInProviderWebhook.parse(JSON.parse(rawBody));
  } catch {
    return new Response("invalid payload", { status: 400 });
  }
  if (!payload.channel_account_id && !payload.provider_account_id) {
    return new Response("missing account reference", { status: 400 });
  }

  const pool = getPool();
  const account = await locateLinkedInChannelAccount(pool, payload);
  if (!account) return new Response(null, { status: 202 });

  const bus = await createJournaledDispatchEventBus({ pool });
  try {
    if (payload.event === "connected" || payload.event === "credentials_refreshed") {
      await bus.publish({
        workspace_id: account.workspace_id,
        event_type: "channel.account.connected",
        source: "webhook",
        producer_ref: "webhook:linkedin:provider",
        idempotency_key: lifecycleIdempotencyKey(payload, account.id),
        payload: {
          channel_account_id: account.id,
          kind: account.kind,
          account_display_name: payload.account_display_name,
          provider_account_id: payload.provider_account_id,
          provider_event_id: payload.provider_event_id,
        },
      });
    } else {
      await bus.publish({
        workspace_id: account.workspace_id,
        event_type: "channel.account.errored",
        source: "webhook",
        producer_ref: "webhook:linkedin:provider",
        idempotency_key: lifecycleIdempotencyKey(payload, account.id),
        payload: {
          channel_account_id: account.id,
          kind: account.kind,
          error: providerErrorMessage(payload),
          status: providerStatus(payload.event),
          account_display_name: payload.account_display_name,
          provider_account_id: payload.provider_account_id,
          provider_event_id: payload.provider_event_id,
          provider_incident_id: payload.provider_incident_id,
          retry_after: payload.retry_after,
        },
      });
    }
  } finally {
    await bus.close();
  }

  return new Response(null, { status: 202 });
}

interface LocatedLinkedInAccount {
  id: string;
  workspace_id: string;
  kind: "linkedin_session" | "linkedin_oauth";
}

async function locateLinkedInChannelAccount(
  pool: ReturnType<typeof getPool>,
  payload: LinkedInProviderWebhookPayload,
): Promise<LocatedLinkedInAccount | null> {
  const { rows } = await pool.query<LocatedLinkedInAccount>(
    `select id, workspace_id, kind::text as kind
       from channel_accounts
      where kind in ('linkedin_session', 'linkedin_oauth')
        and (
          ($1::uuid is not null and id = $1::uuid)
          or ($2::text is not null and properties ->> 'provider_account_id' = $2)
        )
      limit 1`,
    [payload.channel_account_id ?? null, payload.provider_account_id ?? null],
  );
  return rows[0] ?? null;
}
