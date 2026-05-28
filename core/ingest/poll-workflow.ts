import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import {
  defineWorkflow,
  type RunContext,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";
import { getCatalogAdapter } from "./adapters/registry.ts";
import { getTrackedCompany, listCatalogForAdapter } from "./catalog.ts";
import { getPlatformSourceByAdapter } from "./sources.ts";
import { pollOnce } from "./poll.ts";
import type { EmbeddingClient } from "./embeddings.ts";

/**
 * Durable workflow that polls ONE catalog source across every catalog
 * company. Idempotent step-by-step: if it crashes and replays, the
 * per-company state in catalog_poll_cursors picks up where it left off.
 *
 * Input: { adapter_id: 'greenhouse' | ... , page?: number }
 *
 * Implementation: a single workflow invocation polls every company for
 * the adapter, one ctx.step per (source, company). This is a fine model
 * for ~1k catalog companies at a 6h cadence (~3 polls/sec peak inside
 * one workflow run). Beyond that scale, shard by company hash.
 */

export interface CatalogPollWorkflowDeps {
  pool: Pool;
  bus: EventBus;
  embedder: EmbeddingClient;
  fetchImpl?: typeof fetch;
}

export interface CatalogPollInput {
  adapter_id: string;
  /** Optional cap on number of companies polled in a single run.
      Useful for staggering across multiple workflow invocations. */
  limit?: number;
  offset?: number;
}

export interface CatalogPollSummary {
  adapter_id: string;
  source_id: string;
  total_companies: number;
  total_inserted: number;
  total_duplicates: number;
  total_expired: number;
  total_fanned_out: number;
  errors: number;
}

export function createCatalogPollWorkflow(
  deps: CatalogPollWorkflowDeps,
): WorkflowDefinition<CatalogPollInput, CatalogPollSummary> {
  return defineWorkflow<CatalogPollInput, CatalogPollSummary>({
    name: "ingest_catalog_poll",
    version: "1",
    async run(input, ctx): Promise<CatalogPollSummary> {
      if (ctx.execution_scope !== "platform") {
        throw new Error("catalog poll requires a platform-scoped invocation");
      }
      const adapter = getCatalogAdapter(input.adapter_id);
      if (!adapter) throw new Error(`unknown adapter: ${input.adapter_id}`);

      const source = await ctx.step("load_source", async () => {
        const s = await getPlatformSourceByAdapter(deps.pool, input.adapter_id);
        if (!s) {
          throw new Error(`platform_signal_sources missing row for adapter '${input.adapter_id}'`);
        }
        return s;
      });

      const companies = await ctx.step("list_catalog", () =>
        listCatalogForAdapter(deps.pool, input.adapter_id as "greenhouse", {
          limit: input.limit,
          offset: input.offset,
        }),
      );

      const summary: CatalogPollSummary = {
        adapter_id: input.adapter_id,
        source_id: source.id,
        total_companies: companies.length,
        total_inserted: 0,
        total_duplicates: 0,
        total_expired: 0,
        total_fanned_out: 0,
        errors: 0,
      };

      for (const company of companies) {
        const outcome = await ctx.step(
          `poll:${company.id}`,
          async () => {
            const fresh = await getTrackedCompany(deps.pool, company.id);
            if (!fresh) return null;
            return pollOnce(
              { pool: deps.pool, bus: deps.bus, embedder: deps.embedder, fetchImpl: deps.fetchImpl },
              { source_id: source.id, adapter, company: fresh },
            );
          },
          {
            // Adapter failures are represented in PollOutcome; failures that
            // escape here need Restate retry/operator visibility.
            retry: { max_attempts: 2, backoff: "exponential", base_ms: 200 },
          },
        );
        if (!outcome) continue;
        summary.total_inserted += outcome.inserted;
        summary.total_duplicates += outcome.duplicates;
        summary.total_expired += outcome.expired;
        summary.total_fanned_out += outcome.fanned_out;
        if (outcome.error) summary.errors += 1;
      }

      return summary;
    },
  });
}

// Convenience used by app bootstrap or by a Play that triggers a catalog
// poll on demand. Lets the surface layer kick a workflow with a typed
// runtime that's already configured.
export type { RunContext };
