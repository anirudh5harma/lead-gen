import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  discoverSignalFromWebhook,
  hasDatabase,
} from "../../../../core/product/app.ts";

export const dynamic = "force-dynamic";

const SignalKindSchema = z.enum([
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "churn_risk",
  "competitor_move",
  "podcast_mention",
  "press_mention",
  "regulation",
  "expansion",
  "layoff",
  "other",
]);

const SignalWebhookItem = z.object({
  source_id: z.string().uuid().optional(),
  external_id: z.string().min(1),
  title: z.string().min(1),
  content: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  signal_kind: SignalKindSchema.optional(),
  freshness_at: z.string().datetime().optional(),
  structured: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const SignalWebhookPayload = z.union([
  SignalWebhookItem.extend({ source_id: z.string().uuid() }),
  z.object({
    source_id: z.string().uuid().optional(),
    signals: z.array(SignalWebhookItem).min(1).max(50),
  }),
]);

type SignalWebhookItemInput = z.infer<typeof SignalWebhookItem> & {
  source_id: string;
};

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.SIGNAL_WEBHOOK_SECRET?.trim();
  if (!secret || !hasDatabase()) {
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await req.text();
  if (!isAuthorized(req, rawBody, secret)) {
    return Response.json({ error: "invalid_webhook" }, { status: 401 });
  }

  let items: SignalWebhookItemInput[];
  try {
    items = normalizePayload(JSON.parse(rawBody));
  } catch (err) {
    return Response.json(
      { error: "invalid_payload", detail: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const results = [];
  for (const item of items) {
    try {
      results.push(
        await discoverSignalFromWebhook(item, {
          producerRef: "webhook:signals",
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /source not found/i.test(message) ? 404 : 503;
      return Response.json({ error: "signal_discovery_failed", detail: message }, { status });
    }
  }

  return Response.json({ received: items.length, results }, { status: 202 });
}

function normalizePayload(input: unknown): SignalWebhookItemInput[] {
  const parsed = SignalWebhookPayload.parse(input);
  if ("signals" in parsed) {
    return parsed.signals.map((item) => {
      const source_id = item.source_id ?? parsed.source_id;
      if (!source_id) {
        throw new Error("source_id is required on the envelope or each signal.");
      }
      return { ...item, source_id };
    });
  }
  return [parsed];
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
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
