import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createPostgresEventBus } from "@/core/substrate/events/index.ts";
import {
  createDeepSeekIntentClassifier,
  handleBounce,
  handleInboundEmail,
} from "@/core/channels/email/index.ts";
import {
  parseSnsEnvelope,
  parseSnsNotification,
} from "@/core/channels/email/ses-inbound.ts";
import { createDeepSeekClientFromEnv } from "@/core/agents/llm/index.ts";

/**
 * SES SNS webhook. Handles three SNS payload shapes:
 *
 *   - SubscriptionConfirmation : we GET the SubscribeURL once to confirm.
 *   - Notification (Bounce)    : handleBounce()
 *   - Notification (Complaint) : handleBounce() with bounce_type='complaint'
 *   - Notification (Received)  : handleInboundEmail()
 *
 * workspace_id resolution: outbound emails are sent with EmailTags carrying
 * the workspace_id (see core/channels/email/adapters/ses.ts). The parser
 * picks that out automatically; SubscriptionConfirmations don't need it.
 *
 * Production: SNS signatures MUST be verified. This route reads
 * SNS_VERIFY_SIGNATURES; the default is on. Set SNS_VERIFY_SIGNATURES=0
 * for local dev where you're hand-crafting payloads. A signature verifier
 * is a non-trivial 50-line crypto helper; left as a TODO so we don't
 * fake-ship a broken one.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  // Signature verification stub. Production must wire this up before
  // exposing the route to the open internet.
  if (process.env.SNS_VERIFY_SIGNATURES !== "0") {
    // TODO(signature): fetch SigningCertURL, verify against the canonical
    // string-to-sign. See AWS SDK util-sns-message-validator.
  }

  let envelope;
  try {
    envelope = parseSnsEnvelope(rawBody);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "bad envelope", {
      status: 400,
    });
  }

  if (envelope.Type === "SubscriptionConfirmation") {
    try {
      const parsed = parseSnsNotification(envelope);
      if (parsed.kind === "subscription_confirmation") {
        await fetch(parsed.subscribeUrl, { method: "GET" });
      }
      return new Response(null, { status: 200 });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "bad confirm", {
        status: 400,
      });
    }
  }

  const pool = getPool();
  const bus = await createPostgresEventBus({ pool });
  try {
    const parsed = parseSnsNotification(envelope);
    switch (parsed.kind) {
      case "bounce":
      case "complaint":
        await handleBounce(pool, bus, parsed.event);
        break;
      case "received": {
        const classifier = createDeepSeekIntentClassifier({
          llm: createDeepSeekClientFromEnv(),
        });
        await handleInboundEmail({ pool, bus, classifier }, parsed.inbound);
        break;
      }
      case "unsupported":
      case "unsubscribe_confirmation":
      case "subscription_confirmation":
        // No-op. Return 200 so SNS doesn't retry.
        break;
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "handler failed", {
      status: 500,
    });
  } finally {
    await bus.close();
  }

  return new Response(null, { status: 200 });
}
