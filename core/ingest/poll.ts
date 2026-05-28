import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import type { CatalogAdapter } from "./adapters/types.ts";
import type { EmbeddingClient } from "./embeddings.ts";
import { vectorToPgLiteral } from "./embeddings.ts";
import {
  computeNoveltyKey,
  dedupCheck,
  recordCollision,
} from "./novelty.ts";
import {
  loadCursor,
  recordCursorError,
  saveCursor,
} from "./sources.ts";
import type { TrackedCompany } from "./catalog.ts";
import { fanoutCandidate } from "./fanout.ts";
import type { RawCandidate } from "./types.ts";

/**
 * One poll cycle for ONE (catalog source, company) pair. Stage 1 owns
 * every step inside; the only thing this doesn't do is decide WHEN to run.
 * The poll workflow (next file) provides the cadence + durability.
 *
 *   1. Adapter polls upstream → RawCandidate[] + cursor + external_ids_seen.
 *   2. For each item:
 *        a. embed title + lead
 *        b. compute novelty key
 *        c. dedup probe (exact + fuzzy)
 *        d. INSERT into signal_candidates  (or bump novelty_count on hit)
 *        e. fanout to interested workspaces
 *   3. Save cursor + external_ids_seen.
 *   4. Expire candidates whose external_ids dropped out of the new poll
 *      (a job filled, a press release pulled). Flips downstream signals
 *      to 'spent' and emits signal.expired.
 */

export interface PollDeps {
  pool: Pool;
  bus: EventBus;
  embedder: EmbeddingClient;
  fetchImpl?: typeof fetch;
}

export interface PollInput {
  source_id: string;
  adapter: CatalogAdapter;
  company: TrackedCompany;
}

export interface PollOutcome {
  source_id: string;
  company_id: string;
  inserted: number;
  duplicates: number;
  expired: number;
  fanned_out: number;
  error?: string;
}

export async function pollOnce(
  deps: PollDeps,
  input: PollInput,
): Promise<PollOutcome> {
  const { pool, embedder } = deps;
  const outcome: PollOutcome = {
    source_id: input.source_id,
    company_id: input.company.id,
    inserted: 0,
    duplicates: 0,
    expired: 0,
    fanned_out: 0,
  };

  const cursor = await loadCursor(pool, input.source_id, input.company.id);

  let pollResult: Awaited<ReturnType<CatalogAdapter["poll"]>>;
  try {
    pollResult = await input.adapter.poll({
      company: input.company,
      cursor: cursor.cursor,
      fetchImpl: deps.fetchImpl,
    });
  } catch (err) {
    await recordCursorError(pool, input.source_id, input.company.id, err);
    outcome.error = err instanceof Error ? err.message : String(err);
    return outcome;
  }

  // Stage 1: dedup → embed → insert → fanout, per item.
  for (const item of pollResult.items) {
    // Per-item kind overrides the adapter's static kindHint (SEC EDGAR
    // items take different kinds depending on form/item code).
    const itemKind = item.kind ?? input.adapter.kindHint;

    const leadText = `${item.title} ${(item.content ?? "").slice(0, 200)}`.trim();
    const [embedding] = await embedder.embed([leadText]);
    const novelty_key = effectiveNoveltyKey(input.adapter, item, input.company);

    const dedup = await dedupCheck(pool, {
      novelty_key,
      embedding,
      kind: itemKind,
    });
    if (dedup.duplicate && dedup.matched_id) {
      await recordCollision(pool, dedup.matched_id);
      outcome.duplicates += 1;
      continue;
    }

    const candidate_id = randomUUID();
    await pool.query(
      `insert into signal_candidates (
         id, source_id, external_id, external_thread_id,
         kind, company_id, title, content, url,
         structured, provenance, embedding,
         novelty_key, freshness_at, status
       ) values (
         $1, $2, $3, $4,
         $5, $6, $7, $8, $9,
         $10::jsonb, $11::jsonb, $12::vector,
         $13, $14, 'active'
       )
       on conflict (source_id, external_id) do nothing`,
      [
        candidate_id,
        input.source_id,
        item.external_id,
        item.external_thread_id ?? null,
        itemKind ?? null,
        input.company.id,
        item.title,
        item.content ?? null,
        item.url ?? null,
        JSON.stringify(item.structured ?? {}),
        JSON.stringify(item.provenance ?? {}),
        vectorToPgLiteral(embedding),
        novelty_key,
        item.freshness_at,
      ],
    );
    outcome.inserted += 1;

    const fanResults = await fanoutCandidate(
      { pool, bus: deps.bus },
      {
        id: candidate_id,
        source_id: input.source_id,
        kind: itemKind,
        company_id: input.company.id,
        title: item.title,
        content: item.content ?? null,
        url: item.url ?? null,
        structured: item.structured ?? {},
        novelty_count: 1,
        freshness_at: item.freshness_at,
        embedding,
      },
    );
    outcome.fanned_out += fanResults.filter((r) => r.outcome === "created").length;
  }

  // Expire candidates whose external_ids dropped out of the new poll
  // (compare prior `last_external_ids` to the latest `external_ids_seen`).
  const prior = new Set(cursor.last_external_ids);
  const current = new Set(pollResult.external_ids_seen);
  const droppedExternalIds = [...prior].filter((id) => !current.has(id));
  if (droppedExternalIds.length > 0) {
    outcome.expired = await expireDroppedCandidates(
      deps,
      input.source_id,
      droppedExternalIds,
    );
  }

  await saveCursor(
    pool,
    input.source_id,
    input.company.id,
    pollResult.cursor,
    pollResult.external_ids_seen,
  );

  return outcome;
}

/**
 * Pick the right novelty_key for an item depending on the adapter's
 * shape. There are two distinct dedup goals:
 *
 *   - Cross-source event clustering (news): TC + Verge + Crunchbase all
 *     report the same funding round. We want a single signal_candidate
 *     with novelty_count = 3. Key = sha256(domain : kind : iso_week).
 *
 *   - Per-item uniqueness (ATS, ProductHunt, etc.): two different job
 *     postings at the same company in the same week are NOT the same
 *     event. The adapter's external_id discriminates. Key = sha256(
 *     adapter_id : company_id : kind : external_id).
 *
 * Adapter-declared kinds with a stable external_id take the per-item key
 * — fuzzy dedup still catches cross-adapter duplicates (e.g., the same
 * person's hire announced on Greenhouse and in a press release).
 */
function effectiveNoveltyKey(
  adapter: CatalogAdapter,
  item: RawCandidate,
  company: TrackedCompany,
): string {
  const itemKind = item.kind ?? adapter.kindHint;
  if (itemKind && item.external_id) {
    return createHash("sha256")
      .update(
        `${adapter.id}|${company.id}|${itemKind}|${item.external_id}`,
      )
      .digest("hex");
  }
  return computeNoveltyKey({
    domain: item.novelty_hint?.domain ?? company.domain ?? "",
    kind: itemKind ?? "unknown",
    freshness_at: item.freshness_at,
  });
}

/**
 * Mark candidates that fell out of the upstream as expired, then emit
 * `signal.expiry.requested` for every downstream workspace signal so the
 * signal expiry projector flips status='spent' and emits the public
 * signal.expired event. Returns the number of candidates flipped (not
 * the number of signals cascaded — that's the projector's domain).
 */
async function expireDroppedCandidates(
  deps: PollDeps,
  source_id: string,
  external_ids: string[],
): Promise<number> {
  if (external_ids.length === 0) return 0;
  const { rows } = await deps.pool.query<{ id: string }>(
    `update signal_candidates
        set status = 'expired', expired_at = now()
      where source_id = $1
        and external_id = any($2::text[])
        and status = 'active'
      returning id`,
    [source_id, external_ids],
  );
  if (rows.length === 0) return 0;
  const candidate_ids = rows.map((r) => r.id);

  const { rows: sigs } = await deps.pool.query<{
    id: string;
    workspace_id: string;
  }>(
    `select id, workspace_id from signals
      where origin_candidate_id = any($1::uuid[])
        and status in ('ingested', 'matched', 'in_play')`,
    [candidate_ids],
  );
  for (const s of sigs) {
    await deps.bus.publish({
      workspace_id: s.workspace_id,
      event_type: "signal.expiry.requested",
      source: "system",
      producer_ref: "ingest:catalog",
      idempotency_key: `expire:${s.id}:upstream_dropped`,
      payload: { signal_id: s.id, reason: "upstream_dropped" },
    });
  }
  return candidate_ids.length;
}
