import type { SignalKind } from "../../primitives/signal.ts";
import type { RawCandidate } from "../types.ts";
import type { TrackedCompany } from "../catalog.ts";

/**
 * Catalog-driven adapter. One instance per ATS / per shared upstream.
 * Polled per (source, company) by the catalog poll workflow.
 *
 * Adapters declare a `kindHint` — the signal kind every item from this
 * source has. ATS adapters declare 'hiring'; SEC adapters declare based
 * on form/item code; news adapters leave it `null` and the stage-2 LLM
 * classifies.
 *
 * Adapters are PURE: no side effects, no DB writes. They normalise an
 * upstream API response into RawCandidates and return an updated cursor.
 * The poll workflow owns persistence, dedup, embedding, and fanout.
 */

export interface CatalogPollInput {
  company: TrackedCompany;
  cursor: Record<string, unknown>;
  /** Inject a fetch impl for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface CatalogPollResult {
  items: RawCandidate[];
  cursor: Record<string, unknown>;
  /** Every external_id this poll saw — used by the expiration sweep
      to detect items that disappeared from the upstream since last time. */
  external_ids_seen: string[];
}

export interface CatalogAdapter {
  /** Adapter id; matches platform_signal_sources.adapter. */
  id: string;
  /** Signal kind every item from this source has, when knowable. */
  kindHint: SignalKind | null;
  /** Column name on tracked_companies that holds this adapter's board id. */
  companyKeyColumn:
    | "greenhouse_id"
    | "lever_id"
    | "ashby_id"
    | "workable_id"
    | "career_rss_url"
    | "sec_cik";
  /** Run one poll cycle for a single company. */
  poll(input: CatalogPollInput): Promise<CatalogPollResult>;
}
