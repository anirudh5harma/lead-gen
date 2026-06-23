import { z } from "zod";
import {
  discoverSignalFromWebhook,
  hasDatabase,
} from "../../../../core/product/app.ts";
import {
  assertVisitorHasIdentity,
  VisitorEventSchema,
  type VisitorInput,
  visitorSignal,
  visitorSuppressedByConsent,
} from "../../../../core/product/visitor-intent.ts";
import {
  normalizePublicHostname,
  publicHostMatches,
} from "../../../../lib/network/public-url.ts";
import { getPool } from "../../../../core/substrate/storage/index.ts";

export const dynamic = "force-dynamic";

const BrowserVisitorPayload = VisitorEventSchema.extend({
  source_id: z.string().uuid(),
});

type BrowserVisitorPayload = z.infer<typeof BrowserVisitorPayload>;

interface VisitorCollectorSource {
  provider: string;
  allowed_hosts: string[];
}

export async function OPTIONS(req: Request): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(req.headers.get("origin"), true),
  });
}

export async function POST(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (!hasDatabase()) {
    return json({ error: "collector_not_configured" }, 503, origin, true);
  }

  let payload: BrowserVisitorPayload;
  try {
    payload = BrowserVisitorPayload.parse(JSON.parse(await req.text()));
  } catch (err) {
    return json(
      {
        error: "invalid_payload",
        detail: err instanceof Error ? err.message : String(err),
      },
      400,
      origin,
      true,
    );
  }

  const source = await loadVisitorCollectorSource(payload.source_id);
  if (!source) {
    return json({ error: "source_not_found" }, 404, origin, true);
  }
  if (!originAllowed(origin, payload, source.allowed_hosts)) {
    return json({ error: "origin_not_allowed" }, 403, origin, false);
  }

  const visitor: VisitorInput = {
    ...payload,
    provider: payload.provider ?? source.provider,
  };

  if (visitorSuppressedByConsent(visitor)) {
    return json(
      {
        received: 1,
        results: [{ outcome: "skipped:consent_suppressed" }],
      },
      202,
      origin,
      true,
    );
  }

  try {
    assertVisitorHasIdentity(visitor);
  } catch {
    return json(
      {
        received: 1,
        results: [{ outcome: "skipped:identity_missing" }],
      },
      202,
      origin,
      true,
    );
  }

  try {
    const result = await discoverSignalFromWebhook(
      visitorSignal(visitor, { adapter: "browser_collector" }),
      { producerRef: "collector:visitors" },
    );
    return json({ received: 1, results: [result] }, 202, origin, true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /source not found/i.test(message) ? 404 : 503;
    return json(
      { error: "visitor_signal_failed", detail: message },
      status,
      origin,
      true,
    );
  }
}

async function loadVisitorCollectorSource(
  source_id: string,
): Promise<VisitorCollectorSource | null> {
  const result = await getPool().query<{
    provider: string | null;
    config: Record<string, unknown> | null;
    properties: Record<string, unknown> | null;
  }>(
    `select coalesce(config->>'provider', properties->>'provider', 'bombsell_script') as provider,
            config,
            properties
       from graph_sources
      where id = $1
        and enabled
        and kind = 'web_monitor'
      limit 1`,
    [source_id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    provider: row.provider ?? "bombsell_script",
    allowed_hosts: allowedHosts(row.config ?? {}, row.properties ?? {}),
  };
}

function allowedHosts(
  config: Record<string, unknown>,
  properties: Record<string, unknown>,
): string[] {
  return uniqueStrings([
    hostFromUnknown(config.website_url),
    hostFromUnknown(config.company_domain),
    hostFromUnknown(properties.website_url),
    hostFromUnknown(properties.company_domain),
    ...unknownArray(config.allowed_origins).map(hostFromUnknown),
    ...unknownArray(properties.allowed_origins).map(hostFromUnknown),
  ]);
}

function originAllowed(
  origin: string | null,
  payload: BrowserVisitorPayload,
  allowed: string[],
): boolean {
  if (allowed.length === 0) return false;
  const seen = uniqueStrings([
    hostFromUnknown(origin),
    hostFromUnknown(payload.page_url),
    hostFromUnknown(payload.referrer),
    hostFromUnknown(payload.website_url),
  ]);
  return seen.some((host) =>
    allowed.some((allowedHost) =>
      publicHostMatches(host, allowedHost),
    ),
  );
}

function corsHeaders(origin: string | null, allowed: boolean): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  if (allowed) {
    headers.set("Access-Control-Allow-Origin", origin ?? "*");
  }
  return headers;
}

function json(
  body: unknown,
  status: number,
  origin: string | null,
  corsAllowed: boolean,
): Response {
  return Response.json(body, {
    status,
    headers: corsHeaders(origin, corsAllowed),
  });
}

function hostFromUnknown(value: unknown): string | null {
  return normalizePublicHostname(value);
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
