import type { NextRequest } from "next/server";
import { createRuntimeEventBus } from "@/core/substrate/events/index.ts";
import {
  allowedSnsTopicArns,
  SnsConfigurationError,
  validSnsUrl,
  verifySnsMessage,
} from "@/core/channels/email/index.ts";
import {
  parseSnsEnvelope,
  parseSnsNotification,
} from "@/core/channels/email/ses-inbound.ts";
import { isProduction } from "@/core/config/env.ts";

/**
 * SES SNS webhook. Handles three SNS payload shapes:
 *
 *   - SubscriptionConfirmation : we GET the SubscribeURL once to confirm.
 *   - Notification (Bounce)    : emits email.bounce.received
 *   - Notification (Complaint) : emits email.bounce.received
 *   - Notification (Received)  : emits email.inbound.received
 *
 * workspace_id resolution: outbound emails are sent with EmailTags carrying
 * the workspace_id (see core/channels/email/adapters/ses.ts). The parser
 * picks that out automatically; SubscriptionConfirmations don't need it.
 *
 * Production: SNS signatures and an allowed topic ARN are mandatory.
 * SNS_VERIFY_SIGNATURES=0 permits hand-crafted local payloads only outside
 * production.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  let envelope;
  try {
    envelope = parseSnsEnvelope(rawBody);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "bad envelope", {
      status: 400,
    });
  }

  const maySkipVerification =
    process.env.SNS_VERIFY_SIGNATURES === "0" && !isProduction();
  if (!maySkipVerification) {
    try {
      await verifySnsMessage(envelope, {
        allowedTopicArns: allowedSnsTopicArns(),
      });
    } catch (err) {
      const status = err instanceof SnsConfigurationError ? 503 : 401;
      return new Response(
        err instanceof Error ? err.message : "SNS verification failed",
        { status },
      );
    }
  }

  if (envelope.Type === "SubscriptionConfirmation") {
    try {
      const parsed = parseSnsNotification(envelope);
      if (parsed.kind === "subscription_confirmation") {
        if (!validSnsUrl(parsed.subscribeUrl)) {
          return new Response("untrusted SNS confirmation URL", { status: 401 });
        }
        await fetch(parsed.subscribeUrl, { method: "GET" });
      }
      return new Response(null, { status: 200 });
    } catch (err) {
      return new Response(err instanceof Error ? err.message : "bad confirm", {
        status: 400,
      });
    }
  }

  let bus: Awaited<ReturnType<typeof createRuntimeEventBus>>;
  try {
    bus = await createRuntimeEventBus();
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "event bus unavailable", {
      status: 503,
    });
  }
  try {
    const parsed = parseSnsNotification(envelope);
    switch (parsed.kind) {
      case "bounce":
      case "complaint": {
        const { workspace_id, ...payload } = parsed.event;
        await bus.publish({
          workspace_id,
          event_type: "email.bounce.received",
          source: "webhook",
          producer_ref: "webhook:ses:sns",
          idempotency_key: `sns:${envelope.MessageId}`,
          payload,
        });
        break;
      }
      case "received": {
        const { workspace_id, ...payload } = parsed.inbound;
        await bus.publish({
          workspace_id,
          event_type: "email.inbound.received",
          source: "webhook",
          producer_ref: "webhook:ses:sns",
          idempotency_key: `sns:${envelope.MessageId}`,
          payload,
        });
        break;
      }
      case "unsupported":
      case "unsubscribe_confirmation":
      case "subscription_confirmation":
        // No-op. Return 200 so SNS doesn't retry.
        break;
    }
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "enqueue failed", {
      status: 503,
    });
  } finally {
    await bus.close();
  }

  return new Response(null, { status: 200 });
}
