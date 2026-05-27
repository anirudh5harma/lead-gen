import { Webhook } from "standardwebhooks";
import {
  getProductEngine,
  hasDatabase,
} from "../../../../core/product/app.ts";
import { publishResendEmailWebhook } from "../../../../core/product/email-feedback.ts";
import { publishResendDomainWebhook } from "../../../../core/product/domain-provisioning.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret || !hasDatabase()) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawPayload = await req.text();
  const providerEventId = req.headers.get("svix-id");
  let payload: unknown;
  try {
    payload = new Webhook(secret).verify(rawPayload, {
      "svix-id": providerEventId ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    });
  } catch {
    return Response.json({ error: "invalid_webhook" }, { status: 400 });
  }

  const engine = await getProductEngine();
  const domainResult = await publishResendDomainWebhook(engine.pool, engine.bus, payload, {
    providerEventId,
  });
  const result = domainResult.reason === "unsupported_event_type"
    ? await publishResendEmailWebhook(engine.pool, engine.bus, payload, {
        providerEventId,
      })
    : domainResult;
  return Response.json(result, { status: 200 });
}
