import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { SignalKind } from "../primitives/signal.ts";
import { vectorToPgLiteral } from "./embeddings.ts";

/**
 * Cheap dedup for the shared candidates pool. Two tiers:
 *
 *   1. EXACT — sha256(canonical_domain : kind_hint : iso_week) collides
 *      on items reporting the same underlying event from different
 *      sources, when the canonical domain can be extracted.
 *   2. FUZZY — pgvector cosine similarity > threshold on title+lead
 *      embeddings within the same source-family + recent window.
 *
 * Hit → bump novelty_count on the existing row, drop the duplicate.
 * Miss → caller inserts the new row.
 */

export interface NoveltyKeyInput {
  /** Lower-cased registrable domain when available; empty string otherwise. */
  domain: string;
  /** Coarse kind hint — adapter-declared if known, 'unknown' otherwise. */
  kind: SignalKind | "unknown";
  /** Freshness timestamp; rounded to ISO week. */
  freshness_at: string | Date;
}

/**
 * Pure, deterministic. Same inputs → same key, regardless of who calls.
 */
export function computeNoveltyKey(input: NoveltyKeyInput): string {
  const date =
    typeof input.freshness_at === "string"
      ? new Date(input.freshness_at)
      : input.freshness_at;
  const week = isoWeekKey(date);
  const domain = (input.domain ?? "").toLowerCase();
  const raw = `${domain}|${input.kind}|${week}`;
  return createHash("sha256").update(raw).digest("hex");
}

function isoWeekKey(d: Date): string {
  // ISO-8601 week numbering. Thursday-anchored.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week =
    Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ─── Exact dedup ──────────────────────────────────────────────────────────

export interface ExactProbeResult {
  matched_id: string | null;
}

/**
 * Look for an existing active candidate with the same novelty_key. If one
 * exists, the caller should drop the new item and bump novelty_count via
 * `recordCollision`. Returns the existing candidate id when found.
 *
 * Scoped to active candidates only — expired items don't dedupe against
 * fresh reports of the same event (a re-listing is a new signal).
 */
export async function probeExactDuplicate(
  pool: Pool,
  novelty_key: string,
): Promise<ExactProbeResult> {
  if (!novelty_key) return { matched_id: null };
  const { rows } = await pool.query<{ id: string }>(
    `select id from signal_candidates
      where novelty_key = $1 and status = 'active'
      order by ingested_at asc
      limit 1`,
    [novelty_key],
  );
  return { matched_id: rows[0]?.id ?? null };
}

// ─── Fuzzy dedup ──────────────────────────────────────────────────────────

export interface FuzzyProbeOptions {
  /** Threshold on cosine similarity. Default 0.85. */
  threshold?: number;
  /** Window in days to search within. Default 7. */
  window_days?: number;
  /** Restrict to the same signal kind, when known. Defaults to no restriction. */
  kind?: SignalKind | null;
}

export interface FuzzyProbeResult {
  matched_id: string | null;
  similarity: number | null;
}

/**
 * pgvector nearest-neighbour search. Returns the closest candidate within
 * the window if its cosine similarity exceeds the threshold.
 *
 * pgvector exposes cosine DISTANCE via the `<=>` operator, where
 *   similarity = 1 - distance.
 * We sort ascending by distance and compute similarity in code.
 */
export async function probeFuzzyDuplicate(
  pool: Pool,
  embedding: number[],
  opts: FuzzyProbeOptions = {},
): Promise<FuzzyProbeResult> {
  const threshold = opts.threshold ?? 0.85;
  const windowDays = opts.window_days ?? 7;
  const literal = vectorToPgLiteral(embedding);
  if (!literal) return { matched_id: null, similarity: null };

  const { rows } = await pool.query<{ id: string; distance: string }>(
    `select id, (embedding <=> $1::vector)::text as distance
       from signal_candidates
      where status = 'active'
        and embedding is not null
        and ingested_at >= now() - make_interval(days => $3)
        and ($2::text is null or kind::text = $2::text)
      order by embedding <=> $1::vector
      limit 1`,
    [literal, opts.kind ?? null, windowDays],
  );
  const row = rows[0];
  if (!row) return { matched_id: null, similarity: null };
  const similarity = 1 - Number(row.distance);
  return similarity >= threshold
    ? { matched_id: row.id, similarity }
    : { matched_id: null, similarity };
}

// ─── Record a collision ───────────────────────────────────────────────────

/**
 * Bump novelty_count on the existing candidate when a duplicate is seen.
 * A high novelty_count is itself a downstream signal ("this is being
 * widely covered").
 */
export async function recordCollision(
  pool: Pool,
  existing_candidate_id: string,
): Promise<void> {
  await pool.query(
    `update signal_candidates
        set novelty_count = novelty_count + 1
      where id = $1`,
    [existing_candidate_id],
  );
}

// ─── Combined helper ──────────────────────────────────────────────────────

export interface DedupCheckInput {
  novelty_key: string;
  embedding: number[];
  kind?: SignalKind | null;
  fuzzy?: { threshold?: number; window_days?: number };
}

export interface DedupCheckResult {
  duplicate: boolean;
  matched_id: string | null;
  via: "exact" | "fuzzy" | null;
  similarity?: number;
}

/**
 * One-call dedup probe: exact first, fuzzy second. If a duplicate is
 * found, the caller bumps the matched candidate's novelty_count via
 * recordCollision and skips the insert.
 */
export async function dedupCheck(
  pool: Pool,
  input: DedupCheckInput,
): Promise<DedupCheckResult> {
  const exact = await probeExactDuplicate(pool, input.novelty_key);
  if (exact.matched_id) {
    return { duplicate: true, matched_id: exact.matched_id, via: "exact" };
  }
  const fuzzy = await probeFuzzyDuplicate(pool, input.embedding, {
    threshold: input.fuzzy?.threshold,
    window_days: input.fuzzy?.window_days,
    kind: input.kind,
  });
  if (fuzzy.matched_id) {
    return {
      duplicate: true,
      matched_id: fuzzy.matched_id,
      via: "fuzzy",
      similarity: fuzzy.similarity ?? undefined,
    };
  }
  return { duplicate: false, matched_id: null, via: null };
}
