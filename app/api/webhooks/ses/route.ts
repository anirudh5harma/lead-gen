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

function logSnsWebhook(
  level: "info" | "warn" | "error",
  message: string,
  details: Record<string, unknown> = {},
): void {
  console[level]("[ses-sns-webhook]", message, details);
}

async function responseText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const rawBody = await req.text();

  let envelope;
  try {
    envelope = parseSnsEnvelope(rawBody);
  } catch (err) {
    logSnsWebhook("warn", "rejected malformed SNS envelope", {
      error: err instanceof Error ? err.message : String(err),
    });
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
      logSnsWebhook("error", "SNS verification failed", {
        type: envelope.Type,
        topicArn: envelope.TopicArn ?? null,
        configuredTopicCount: allowedSnsTopicArns().length,
        status,
        error: err instanceof Error ? err.message : String(err),
      });
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
          logSnsWebhook("error", "rejected untrusted SNS SubscribeURL", {
            type: envelope.Type,
            topicArn: envelope.TopicArn ?? null,
          });
          return new Response("untrusted SNS confirmation URL", { status: 401 });
        }
        const confirmation = await fetch(parsed.subscribeUrl, {
          method: "GET",
          cache: "no-store",
        });
        if (!confirmation.ok) {
          const body = await responseText(confirmation);
          logSnsWebhook("error", "SNS subscription confirmation request failed", {
            topicArn: envelope.TopicArn ?? null,
            status: confirmation.status,
            body,
          });
          return new Response(
            `SNS confirmation failed (${confirmation.status}): ${body}`,
            { status: 502 },
          );
        }
        logSnsWebhook("info", "SNS subscription confirmed", {
          topicArn: envelope.TopicArn ?? null,
          status: confirmation.status,
        });
      }
      return new Response(null, { status: 200 });
    } catch (err) {
      logSnsWebhook("error", "SNS subscription confirmation handler failed", {
        type: envelope.Type,
        topicArn: envelope.TopicArn ?? null,
        error: err instanceof Error ? err.message : String(err),
      });
      return new Response(err instanceof Error ? err.message : "bad confirm", {
        status: 400,
      });
    }
  }

  let bus: Awaited<ReturnType<typeof createRuntimeEventBus>>;
  try {
    bus = await createRuntimeEventBus();
  } catch (err) {
    logSnsWebhook("error", "event bus unavailable for SNS notification", {
      type: envelope.Type,
      topicArn: envelope.TopicArn ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
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
    logSnsWebhook("error", "SNS notification enqueue failed", {
      type: envelope.Type,
      topicArn: envelope.TopicArn ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
    return new Response(err instanceof Error ? err.message : "enqueue failed", {
      status: 503,
    });
  } finally {
    await bus.close();
  }

  return new Response(null, { status: 200 });
}
