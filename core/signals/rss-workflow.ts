import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { connect } from "../graph/edges/index.ts";
import { getSource, markSourcePolled } from "../graph/nodes/sources.ts";
import { SignalKind, type SignalKind as SignalKindType } from "../primitives/signal.ts";
import type { Signal } from "../primitives/index.ts";
import { defineWorkflow } from "../substrate/workflows/index.ts";
import { parseRssSignals } from "./sources.ts";

export const RSS_SIGNAL_INGESTION_WORKFLOW = "signals.rss_ingest.v1";

export interface RssSignalIngestionInput {
  workspace_id: string;
  source_id: string;
  limit?: number;
}

export interface RssSignalIngestionOutput {
  source_id: string;
  fetched: number;
  inserted: number;
  updated: number;
  signal_ids: string[];
}

export type FetchLike = (
  url: string,
) => Promise<{
  ok: boolean;
  status: number;
  statusText?: string;
  text(): Promise<string>;
}>;

export interface RssSignalIngestionWorkflowOptions {
  pool: Pool;
  fetchImpl?: FetchLike;
}

interface UpsertResult {
  inserted: Array<{
    id: string;
    kind: SignalKindType;
    novelty_score: number | null;
  }>;
  updated: string[];
}

interface UpsertSignalRow {
  id: string;
  inserted: boolean;
}

function stringConfig(
  config: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function numberConfig(
  config: Record<string, unknown>,
  key: string,
): number | null {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function signalKindFromConfig(
  config: Record<string, unknown>,
): SignalKindType | undefined {
  const value = config.kind ?? config.signal_kind;
  if (typeof value !== "string") return undefined;
  const parsed = SignalKind.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function mergeSourceMetadata(
  signal: Signal,
  source_id: string,
  sourceName: string,
): Signal {
  return {
    ...signal,
    id: signal.id || randomUUID(),
    source_id,
    properties: {
      ...signal.properties,
      source_name: sourceName,
      source_kind: "rss",
    },
    provenance: {
      ...signal.provenance,
      source: "rss",
      source_id,
    },
  };
}

async function upsertRssSignals(
  pool: Pool,
  source: { id: string; workspace_id: string; name: string },
  signals: Signal[],
): Promise<UpsertResult> {
  const inserted: UpsertResult["inserted"] = [];
  const updated: string[] = [];

  for (const signal of signals) {
    const result = await pool.query<UpsertSignalRow>(
      `insert into signals (
         id, workspace_id, source_id, kind, title, content, url, novelty_key,
         novelty_score, freshness_at, audience_hint, match_score, match_reason,
         related_company_id, related_person_id, status, properties, provenance,
         ingested_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13,
         $14, $15, $16, $17::jsonb, $18::jsonb, $19
       )
       on conflict (workspace_id, source_id, novelty_key)
       where source_id is not null and novelty_key is not null
       do update set
         kind = excluded.kind,
         title = excluded.title,
         content = excluded.content,
         url = coalesce(excluded.url, signals.url),
         novelty_score = excluded.novelty_score,
         freshness_at = excluded.freshness_at,
         audience_hint = signals.audience_hint || excluded.audience_hint,
         match_score = coalesce(signals.match_score, excluded.match_score),
         match_reason = coalesce(signals.match_reason, excluded.match_reason),
         properties = signals.properties || excluded.properties,
         provenance = signals.provenance || excluded.provenance
       returning id, xmax::text = '0' as inserted`,
      [
        signal.id,
        source.workspace_id,
        source.id,
        signal.kind,
        signal.title,
        signal.content,
        signal.url,
        signal.novelty_key,
        signal.novelty_score,
        signal.freshness_at,
        JSON.stringify(signal.audience_hint),
        signal.match_score,
        signal.match_reason,
        signal.related_company_id,
        signal.related_person_id,
        signal.status,
        JSON.stringify(signal.properties),
        JSON.stringify(signal.provenance),
        signal.ingested_at,
      ],
    );

    await connect(pool, {
      workspace_id: source.workspace_id,
      from: { node_type: "source", node_id: source.id },
      to: { node_type: "signal", node_id: result.rows[0]!.id },
      kind: "emitted",
      properties: { novelty_key: signal.novelty_key },
      provenance: { source: "rss-ingestion" },
    });

    if (result.rows[0]!.inserted) {
      inserted.push({
        id: result.rows[0]!.id,
        kind: signal.kind,
        novelty_score: signal.novelty_score,
      });
    } else {
      updated.push(result.rows[0]!.id);
    }
  }

  return { inserted, updated };
}

export function createRssSignalIngestionWorkflow(
  opts: RssSignalIngestionWorkflowOptions,
) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("RSS ingestion requires a fetch implementation.");
  }

  return defineWorkflow<RssSignalIngestionInput, RssSignalIngestionOutput>({
    name: RSS_SIGNAL_INGESTION_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const source = await ctx.step("source.load", async () => {
        const row = await getSource(opts.pool, input.workspace_id, input.source_id);
        if (!row) throw new Error(`RSS source not found: ${input.source_id}`);
        if (row.kind !== "rss") {
          throw new Error(`Source ${input.source_id} is ${row.kind}, not rss.`);
        }
        if (!row.enabled) {
          throw new Error(`RSS source disabled: ${input.source_id}`);
        }
        return row;
      });

      const url = stringConfig(source.config, "url", "feed_url", "rss_url");
      if (!url) throw new Error(`RSS source ${source.id} is missing config.url.`);

      const xml = await ctx.step("rss.fetch", async () => {
        const response = await fetchImpl(url);
        if (!response.ok) {
          throw new Error(
            `RSS fetch failed for ${url}: ${response.status} ${response.statusText ?? ""}`.trim(),
          );
        }
        return response.text();
      });

      const signals = await ctx.step("rss.parse", async () => {
        const limit = input.limit ?? numberConfig(source.config, "limit") ?? 25;
        return (await parseRssSignals({
          workspace_id: input.workspace_id,
          xml,
          kind: signalKindFromConfig(source.config),
          limit,
        })).map((signal) => mergeSourceMetadata(signal, source.id, source.name));
      });

      const upserted = await ctx.step("signals.upsert", async () =>
        upsertRssSignals(opts.pool, source, signals),
      );

      for (const signal of upserted.inserted) {
        await ctx.step(`signal.ingested.${signal.id}`, async () => {
          await ctx.publish("signal.ingested", {
            signal_id: signal.id,
            source_id: source.id,
            kind: signal.kind,
            novelty_score: signal.novelty_score,
          });
          return { signal_id: signal.id };
        });
      }

      await ctx.step("source.mark_polled", async () => {
        await markSourcePolled(opts.pool, source.workspace_id, source.id);
        return { source_id: source.id };
      });

      return {
        source_id: source.id,
        fetched: signals.length,
        inserted: upserted.inserted.length,
        updated: upserted.updated.length,
        signal_ids: [
          ...upserted.inserted.map((signal) => signal.id),
          ...upserted.updated,
        ],
      };
    },
  });
}
