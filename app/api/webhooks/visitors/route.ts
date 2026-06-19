import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  discoverSignalFromWebhook,
  hasDatabase,
} from "../../../../core/product/app.ts";

export const dynamic = "force-dynamic";

const VisitorEvent = z.object({
  source_id: z.string().uuid().optional(),
  external_id: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  company_name: z.string().min(1).optional(),
  company_domain: z.string().min(1).optional(),
  website_url: z.string().url().optional(),
  page_url: z.string().url().optional(),
  referrer: z.string().url().optional(),
  person_name: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  email: z.string().email().optional(),
  linkedin_url: z.string().url().optional(),
  intent_score: z.number().min(0).max(1).optional(),
  visited_at: z.string().datetime().optional(),
  pages: z.array(z.string().min(1)).max(20).optional(),
  structured: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

const VisitorPayload = z.union([
  VisitorEvent.extend({ source_id: z.string().uuid() }),
  z.object({
    source_id: z.string().uuid().optional(),
    visitors: z.array(VisitorEvent).min(1).max(50),
  }),
]);

type VisitorInput = z.infer<typeof VisitorEvent> & { source_id: string };

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
    visitors = normalizePayload(JSON.parse(rawBody));
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

function normalizePayload(input: unknown): VisitorInput[] {
  const parsed = VisitorPayload.parse(input);
  const visitors = "visitors" in parsed ? parsed.visitors : [parsed];
  return visitors.map((visitor) => {
    const source_id = visitor.source_id ?? ("visitors" in parsed ? parsed.source_id : undefined);
    if (!source_id) {
      throw new Error("source_id is required on the envelope or each visitor.");
    }
    if (
      !visitor.company_name &&
      !visitor.company_domain &&
      !visitor.email &&
      !visitor.linkedin_url
    ) {
      throw new Error(
        "visitor must include company_name, company_domain, email, or linkedin_url.",
      );
    }
    return { ...visitor, source_id };
  });
}

function visitorSignal(visitor: VisitorInput) {
  const provider = clean(visitor.provider) ?? "visitor_deanonymization";
  const company =
    clean(visitor.company_name) ??
    clean(visitor.company_domain) ??
    clean(visitor.email) ??
    "Identified visitor";
  const page = clean(visitor.page_url ?? visitor.website_url);
  const person = clean(visitor.person_name);
  const title = person
    ? `Website visitor intent: ${person} at ${company}`
    : `Website visitor intent: ${company}`;
  const content = [
    person ? `Person: ${person}` : null,
    visitor.title ? `Title: ${visitor.title}` : null,
    visitor.email ? `Email: ${visitor.email}` : null,
    visitor.linkedin_url ? `LinkedIn: ${visitor.linkedin_url}` : null,
    visitor.company_domain ? `Company domain: ${visitor.company_domain}` : null,
    page ? `Visited: ${page}` : null,
    visitor.referrer ? `Referrer: ${visitor.referrer}` : null,
    typeof visitor.intent_score === "number"
      ? `Intent score: ${visitor.intent_score.toFixed(2)}`
      : null,
    visitor.pages?.length ? `Pages: ${visitor.pages.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    source_id: visitor.source_id,
    external_id:
      clean(visitor.external_id) ??
      [
        provider,
        clean(visitor.company_domain),
        clean(visitor.email),
        page,
        visitor.visited_at,
      ]
        .filter(Boolean)
        .join(":"),
    title,
    content: content || null,
    url: page ?? null,
    signal_kind: "other" as const,
    freshness_at: visitor.visited_at ?? new Date().toISOString(),
    structured: {
      ...(visitor.structured ?? {}),
      visitor_deanonymization: true,
      provider,
      company_name: visitor.company_name ?? null,
      company_domain: visitor.company_domain ?? null,
      person_name: visitor.person_name ?? null,
      title: visitor.title ?? null,
      email: visitor.email ?? null,
      linkedin_url: visitor.linkedin_url ?? null,
      intent_score: visitor.intent_score ?? null,
      pages: visitor.pages ?? [],
    },
    provenance: {
      ...(visitor.provenance ?? {}),
      adapter: "webhook",
      provider,
      source: "visitor_deanonymization",
    },
  };
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

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
