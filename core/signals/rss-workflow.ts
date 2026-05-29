import type { Pool } from "pg";
import { getSource, markSourcePolled } from "../graph/nodes/sources.ts";
import { SignalKind, type SignalKind as SignalKindType } from "../primitives/signal.ts";
import type { Signal } from "../primitives/index.ts";
import { defineWorkflow } from "../substrate/workflows/index.ts";
import type { EventBus } from "../substrate/events/index.ts";
import {
  discoverWorkspaceSignal,
  prepareWorkspaceSignalDiscoveryContext,
  type EmbeddingClient,
  type WorkspaceSignalDiscoveryResult,
} from "../ingest/index.ts";
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
  skipped: number;
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
  bus: EventBus;
  embedder: EmbeddingClient;
  fetchImpl?: FetchLike;
}

interface DiscoverySummary {
  created: string[];
  deduped: string[];
  skipped: number;
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

function externalIdForSignal(signal: Signal): string {
  return signal.novelty_key || signal.url || signal.title;
}

function countDiscovery(
  summary: DiscoverySummary,
  result: WorkspaceSignalDiscoveryResult,
): void {
  if (result.outcome === "created") {
    summary.created.push(result.signal_id);
    return;
  }
  if (result.outcome === "skipped:dedup") {
    if (result.signal_id) summary.deduped.push(result.signal_id);
    else summary.skipped++;
    return;
  }
  summary.skipped++;
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
        return parseRssSignals({
          workspace_id: input.workspace_id,
          xml,
          kind: signalKindFromConfig(source.config),
          limit,
        });
      });

      const discovered = await ctx.step("signals.discover", async () => {
        const discoveryContext = await prepareWorkspaceSignalDiscoveryContext(
          {
            pool: opts.pool,
            bus: opts.bus,
            embedder: opts.embedder,
          },
          {
            workspace_id: input.workspace_id,
            source: {
              id: source.id,
              workspace_id: source.workspace_id,
              kind: source.kind,
              name: source.name,
              config: source.config,
            },
            adapter_id: "rss",
            kind_hint: signalKindFromConfig(source.config) ?? null,
          },
        );
        const summary: DiscoverySummary = {
          created: [],
          deduped: [],
          skipped: 0,
        };
        for (const signal of signals) {
          const external_id = externalIdForSignal(signal);
          const result = await discoverWorkspaceSignal(
            {
              pool: opts.pool,
              bus: opts.bus,
              embedder: opts.embedder,
            },
            discoveryContext,
            {
              external_id,
              title: signal.title,
              content: signal.content ?? undefined,
              url: signal.url ?? undefined,
              kind: signal.kind,
              freshness_at: signal.freshness_at,
              properties: {
                ...signal.properties,
                source_name: source.name,
                source_kind: "rss",
                novelty_key: signal.novelty_key,
                novelty_score: signal.novelty_score,
              },
              structured: {
                source_name: source.name,
                novelty_key: signal.novelty_key,
                novelty_score: signal.novelty_score,
              },
              provenance: {
                ...signal.provenance,
                source: "rss",
                source_id: source.id,
                external_id,
              },
              producer_ref: `workflow:${RSS_SIGNAL_INGESTION_WORKFLOW}`,
            },
          );
          countDiscovery(summary, result);
        }
        return summary;
      });

      await ctx.step("source.mark_polled", async () => {
        await markSourcePolled(opts.pool, source.workspace_id, source.id);
        return { source_id: source.id };
      });

      return {
        source_id: source.id,
        fetched: signals.length,
        inserted: discovered.created.length,
        updated: discovered.deduped.length,
        skipped: discovered.skipped,
        signal_ids: [...discovered.created, ...discovered.deduped],
      };
    },
  });
}
