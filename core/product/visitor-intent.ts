import { z } from "zod";
import type { DiscoverWorkspaceSignalInput } from "./app.ts";

export const VisitorEventSchema = z.object({
  source_id: z.string().uuid().optional(),
  external_id: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  company_name: z.string().min(1).optional(),
  company_domain: z.string().min(1).optional(),
  industry: z.string().min(1).optional(),
  headcount: z.union([z.string().min(1), z.number().int().nonnegative()]).optional(),
  funding_stage: z.string().min(1).optional(),
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
  weighted_pages: z
    .array(
      z.object({
        path: z.string().min(1).optional(),
        url: z.string().url().optional(),
        intent_weight: z.number().min(0).max(1).optional(),
        dwell_time_seconds: z.number().nonnegative().optional(),
        scroll_depth: z.number().min(0).max(1).optional(),
        visited_at: z.string().datetime().optional(),
      }),
    )
    .max(20)
    .optional(),
  dwell_time_seconds: z.number().nonnegative().optional(),
  scroll_depth: z.number().min(0).max(1).optional(),
  repeat_visits: z.number().int().nonnegative().optional(),
  visit_count: z.number().int().nonnegative().optional(),
  consent: z
    .object({
      marketing_allowed: z.boolean().optional(),
      do_not_track: z.boolean().optional(),
      privacy_disclosed: z.boolean().optional(),
      record_id: z.string().min(1).optional(),
      source: z.string().min(1).optional(),
      timestamp: z.string().datetime().optional(),
      region: z.string().min(1).optional(),
      ip: z.string().min(1).optional(),
    })
    .passthrough()
    .optional(),
  structured: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
});

export const VisitorPayloadSchema = z.union([
  VisitorEventSchema.extend({ source_id: z.string().uuid() }),
  z.object({
    source_id: z.string().uuid().optional(),
    visitors: z.array(VisitorEventSchema).min(1).max(50),
  }),
]);

export type VisitorEventInput = z.infer<typeof VisitorEventSchema>;
export type VisitorInput = VisitorEventInput & { source_id: string };

export function normalizeVisitorPayload(input: unknown): VisitorInput[] {
  const parsed = VisitorPayloadSchema.parse(input);
  const visitors = "visitors" in parsed ? parsed.visitors : [parsed];
  return visitors.map((visitor) => {
    const source_id =
      visitor.source_id ?? ("visitors" in parsed ? parsed.source_id : undefined);
    if (!source_id) {
      throw new Error("source_id is required on the envelope or each visitor.");
    }
    assertVisitorHasIdentity(visitor);
    return { ...visitor, source_id };
  });
}

export function assertVisitorHasIdentity(visitor: VisitorEventInput): void {
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
}

export function visitorSuppressedByConsent(visitor: VisitorInput): boolean {
  return (
    visitor.consent?.marketing_allowed === false ||
    visitor.consent?.do_not_track === true
  );
}

export function visitorSignal(
  visitor: VisitorInput,
  opts: { adapter?: "webhook" | "browser_collector" } = {},
): DiscoverWorkspaceSignalInput {
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
    visitor.industry ? `Industry: ${visitor.industry}` : null,
    visitor.headcount != null ? `Headcount: ${String(visitor.headcount)}` : null,
    visitor.funding_stage ? `Funding stage: ${visitor.funding_stage}` : null,
    page ? `Visited: ${page}` : null,
    visitor.referrer ? `Referrer: ${visitor.referrer}` : null,
    typeof visitor.intent_score === "number"
      ? `Intent score: ${visitor.intent_score.toFixed(2)}`
      : null,
    typeof visitor.dwell_time_seconds === "number"
      ? `Dwell time: ${Math.round(visitor.dwell_time_seconds)}s`
      : null,
    typeof visitor.scroll_depth === "number"
      ? `Scroll depth: ${Math.round(visitor.scroll_depth * 100)}%`
      : null,
    visitor.repeat_visits != null || visitor.visit_count != null
      ? `Visits: ${visitor.repeat_visits ?? visitor.visit_count}`
      : null,
    visitor.pages?.length ? `Pages: ${visitor.pages.join(", ")}` : null,
    visitor.weighted_pages?.length
      ? `Weighted pages: ${visitor.weighted_pages.map(weightedPageLabel).join(", ")}`
      : null,
    visitor.consent?.record_id ? `Consent record: ${visitor.consent.record_id}` : null,
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
      industry: visitor.industry ?? null,
      headcount: visitor.headcount ?? null,
      funding_stage: visitor.funding_stage ?? null,
      person_name: visitor.person_name ?? null,
      title: visitor.title ?? null,
      email: visitor.email ?? null,
      linkedin_url: visitor.linkedin_url ?? null,
      intent_score: visitor.intent_score ?? null,
      pages: visitor.pages ?? [],
      weighted_pages: visitor.weighted_pages ?? [],
      dwell_time_seconds: visitor.dwell_time_seconds ?? null,
      scroll_depth: visitor.scroll_depth ?? null,
      repeat_visits: visitor.repeat_visits ?? visitor.visit_count ?? null,
      consent: visitor.consent ?? null,
    },
    provenance: {
      ...(visitor.provenance ?? {}),
      adapter: opts.adapter ?? "webhook",
      provider,
      source: "visitor_deanonymization",
      consent_record_id: visitor.consent?.record_id ?? null,
      consent_region: visitor.consent?.region ?? null,
    },
  };
}

function weightedPageLabel(page: NonNullable<VisitorInput["weighted_pages"]>[number]): string {
  const viewed = page.url ?? page.path ?? "unknown";
  return typeof page.intent_weight === "number"
    ? `${viewed} (${page.intent_weight.toFixed(2)})`
    : viewed;
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
