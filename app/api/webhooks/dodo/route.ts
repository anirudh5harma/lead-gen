import { Webhook } from "standardwebhooks";
import { getPool } from "@/core/substrate/storage/index.ts";
import { createJournaledDispatchEventBus } from "@/core/substrate/events/index.ts";
import {
  handleDodoWebhookEvent,
  type DodoWebhookPayload,
} from "@/core/billing/index.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "Webhook secret not configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const webhookId = request.headers.get("webhook-id");

  try {
    const wh = new Webhook(secret);
    wh.verify(rawBody, {
      "webhook-id": webhookId ?? "",
      "webhook-signature": request.headers.get("webhook-signature") ?? "",
      "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    });
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  let payload: DodoWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as DodoWebhookPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pool = getPool();
  const bus = await createJournaledDispatchEventBus({ pool });
  try {
    const result = await handleDodoWebhookEvent(pool, bus, payload, {
      webhookId,
    });
    if (!result.handled && result.reason !== "irrelevant_event") {
      console.warn("[dodo webhook] ignored event", {
        type: payload.type,
        reason: result.reason,
      });
    }
  } catch (err) {
    console.error("[dodo webhook] processing failed", err);
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  } finally {
    await bus.close();
  }

  return Response.json({ ok: true });
}
