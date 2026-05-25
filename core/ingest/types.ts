/**
 * Shared types for the signal-ingestion subsystem. Adapters return
 * RawCandidates from upstream APIs; the pipeline turns them into rows in
 * `signal_candidates` (the shared pool) and, via fanout, into workspace-
 * scoped `signals` rows.
 *
 * See docs/signal-ingestion.md for the full design.
 */

import type { SignalKind } from "../primitives/signal.ts";

/**
 * A single item returned by an adapter's poll. The pipeline owns persistence,
 * embedding, dedup, and fanout — adapters just normalise upstream payloads.
 */
export interface RawCandidate {
  /** Upstream item identity. Unique within the source. */
  external_id: string;
  external_thread_id?: string;
  title: string;
  content?: string;
  url?: string;
  /** Adapter-extracted structured fields. Shape varies by adapter. */
  structured?: Record<string, unknown>;
  /** When the upstream event actually happened, ISO timestamp. */
  freshness_at: string;
  /** Raw upstream payload subset for forensics. */
  provenance?: Record<string, unknown>;
  /** Optional adapter-supplied novelty hint (e.g. canonical company domain). */
  novelty_hint?: { domain?: string };
}

/**
 * What the embedding step accepts. The pipeline builds this from the
 * candidate's title + lead.
 */
export interface EmbeddingInput {
  text: string;
}
