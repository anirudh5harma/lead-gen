import { createHmac, timingSafeEqual } from "node:crypto";
import {
  discoverSignalFromWebhook,
  hasDatabase,
} from "../../../../core/product/app.ts";
import {
  normalizeVisitorPayload,
  type VisitorInput,
  visitorSignal,
  visitorSuppressedByConsent,
} from "../../../../core/product/visitor-intent.ts";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SIGNAL_WEBHOOK_SECRET?.trim();
  if (!secret || !hasDatabase()) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!isAuthorized(req, rawBody, secret)) {
    return Response.json({ error: "invalid_webhook" }, { status: 401 });
  }

  let visitors: VisitorInput[];
  try {
    visitors = normalizeVisitorPayload(JSON.parse(rawBody));
  } catch (err) {
    return Response.json(
      {
        error: "invalid_payload",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  const results = [];
  for (const visitor of visitors) {
    if (visitorSuppressedByConsent(visitor)) {
      results.push({
        outcome: "skipped:consent_suppressed",
        external_id: visitor.external_id?.trim() || null,
      });
      continue;
    }

    try {
      results.push(
        await discoverSignalFromWebhook(visitorSignal(visitor), {
          producerRef: "webhook:visitors",
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /source not found/i.test(message) ? 404 : 503;
      return Response.json(
        { error: "visitor_signal_failed", detail: message },
        { status },
      );
    }
  }

  return Response.json({ received: visitors.length, results }, { status: 202 });
}

function isAuthorized(req: Request, rawBody: string, secret: string): boolean {
  const authorization = req.headers.get("authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return safeEqual(authorization.slice("bearer ".length).trim(), secret);
  }

  const signature =
    req.headers.get("x-bombsell-signature") ??
    req.headers.get("x-hub-signature-256");
  if (!signature) return false;

  const timestamp = req.headers.get("x-bombsell-timestamp");
  if (timestamp && !isFreshTimestamp(timestamp)) return false;
  const signedPayload = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const provided = signature.replace(/^sha256=/i, "").trim();
  return safeEqualHex(provided, expected);
}

function isFreshTimestamp(value: string): boolean {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  return Math.abs(Date.now() - ms) <= 5 * 60 * 1000;
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
