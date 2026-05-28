import { randomUUID } from "node:crypto";
import { parseStringPromise } from "xml2js";
import type { EventBus } from "../substrate/events/index.ts";
import type { GraphCompany, GraphPerson } from "../graph/types.ts";
import type { Signal, SignalKind } from "../primitives/index.ts";
import type { VerticalSliceStore } from "../plays/vertical-store.ts";

export interface ManualSignalInput {
  id?: string;
  workspace_id: string;
  kind: SignalKind;
  title: string;
  content?: string | null;
  url?: string | null;
  icp_segment?: string;
  match_score?: number | null;
  company?: GraphCompany;
  person?: GraphPerson;
  properties?: Record<string, unknown>;
}

export interface SignalIngestContext {
  store: VerticalSliceStore;
  bus: EventBus;
  producer_ref?: string;
}

export async function ingestManualSignal(
  input: ManualSignalInput,
  ctx: SignalIngestContext,
): Promise<Signal> {
  let company = input.company;
  let person = input.person;
  if (input.company && ctx.store.upsertCompany) {
    company = await ctx.store.upsertCompany(input.company);
  }
  if (person && company && input.company) {
    person = { ...person, company_id: company.id };
  }
  if (person && ctx.store.upsertPerson) {
    person = await ctx.store.upsertPerson(person);
  }

  const now = new Date().toISOString();
  const signal: Signal = {
    id: input.id ?? randomUUID(),
    workspace_id: input.workspace_id,
    source_id: null,
    kind: input.kind,
    title: input.title,
    content: input.content ?? null,
    url: input.url ?? null,
    novelty_key: input.url ?? input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    novelty_score: 1,
    freshness_at: now,
    audience_hint: {
      icp_segment: input.icp_segment,
      confidence: input.match_score ?? undefined,
      rationale: "Manual signal entered by a user or internal operator.",
    },
    match_score: input.match_score ?? null,
    match_reason: input.match_score == null ? null : "Manual signal pre-matched.",
    related_company_id: company?.id ?? null,
    related_person_id: person?.id ?? null,
    status: input.match_score == null ? "ingested" : "matched",
    properties: input.properties ?? {},
    provenance: { source: "manual" },
    ingested_at: now,
  };

  if (ctx.store.upsertSignal) {
    await ctx.store.upsertSignal(signal);
  }
  await ctx.bus.publish({
    workspace_id: input.workspace_id,
    event_type: "signal.ingested",
    source: "user",
    producer_ref: ctx.producer_ref ?? "signal-source:manual",
    payload: {
      signal_id: signal.id,
      source_id: null,
      kind: signal.kind,
      novelty_score: signal.novelty_score,
    },
  });
  if (input.match_score != null) {
    await ctx.bus.publish({
      workspace_id: input.workspace_id,
      event_type: "signal.matched",
      source: "user",
      producer_ref: ctx.producer_ref ?? "signal-source:manual",
      payload: {
        signal_id: signal.id,
        match_score: input.match_score,
        icp_segment: input.icp_segment,
      },
    });
  }
  return signal;
}

interface RssItemShape {
  title?: string[];
  link?: string[];
  description?: string[];
  pubDate?: string[];
}

interface RssShape {
  rss?: {
    channel?: Array<{
      item?: RssItemShape[];
    }>;
  };
}

export async function parseRssSignals(input: {
  workspace_id: string;
  xml: string;
  kind?: SignalKind;
  limit?: number;
}): Promise<Signal[]> {
  const parsed = (await parseStringPromise(input.xml, {
    explicitArray: true,
    trim: true,
  })) as RssShape;
  const items = parsed.rss?.channel?.[0]?.item ?? [];
  return items.slice(0, input.limit ?? 25).map((item) => {
    const now = new Date().toISOString();
    const pubDate = item.pubDate?.[0];
    const freshness = pubDate && !Number.isNaN(Date.parse(pubDate))
      ? new Date(pubDate).toISOString()
      : now;
    const title = item.title?.[0] ?? "Untitled RSS signal";
    const url = item.link?.[0] ?? null;
    return {
      id: randomUUID(),
      workspace_id: input.workspace_id,
      source_id: null,
      kind: input.kind ?? "press_mention",
      title,
      content: item.description?.[0] ?? null,
      url,
      novelty_key: url ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      novelty_score: 0.8,
      freshness_at: freshness,
      audience_hint: {},
      match_score: null,
      match_reason: null,
      related_company_id: null,
      related_person_id: null,
      status: "ingested",
      properties: {},
      provenance: { source: "rss" },
      ingested_at: now,
    } satisfies Signal;
  });
}
