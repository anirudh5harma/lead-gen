import type { Pool } from "pg";
import type { EventBus } from "../substrate/events/index.ts";
import type { SignalKind } from "../primitives/signal.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../substrate/workflows/index.ts";

/**
 * Periodic expiration sweep. Distinct from poll.ts's `expireDroppedCandidates`
 * (which catches items that fell out of the upstream listing on the next
 * poll). This sweep handles the case where the upstream may still list the
 * item but it has aged past usefulness — a year-old job posting, a stale
 * funding signal — by applying kind-specific TTLs to `freshness_at`.
 *
 *   1. Sweep signal_candidates whose freshness_at is past the kind TTL and
 *      are still 'active'; flip to 'expired'.
 *   2. For each newly-expired candidate, cascade to workspace-scoped signals
 *      via origin_candidate_id; flip 'ingested'|'matched'|'in_play' to
 *      'spent' and emit signal.expired.
 *   3. Sweep workspace-scoped signals with NULL origin_candidate_id (came
 *      from workspace adapters, not the shared pool) past the kind TTL;
 *      flip to 'spent' and emit signal.expired.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Days-of-freshness per signal kind. Picked to roughly match how long the
 * signal remains an actionable conversation-opener:
 *   - hiring: a 45-day-old job posting is usually filled or stale.
 *   - funding / acquisition: investor-news shelf life is ~90 days.
 *   - leadership_change: ~120 days (the "new VP" window stays open longer).
 *   - press_mention / podcast: 30 days.
 *   - regulation / churn_risk / competitor_move: 60 days.
 *   - other / null: 60 days as a safe default.
 */
export const DEFAULT_KIND_TTL_DAYS: Record<string, number> = {
  hiring: 45,
  funding: 90,
  acquisition: 90,
  leadership_change: 120,
  product_launch: 60,
  press_mention: 30,
  podcast_mention: 30,
  regulation: 60,
  churn_risk: 60,
  competitor_move: 60,
  expansion: 60,
  layoff: 60,
  other: 60,
};

const DEFAULT_NULL_KIND_TTL_DAYS = 60;

export interface ExpireDeps {
  pool: Pool;
  bus: EventBus;
  /** Override per-kind TTLs in days. Merged onto the defaults. */
  ttlDaysByKind?: Partial<Record<string, number>>;
  /** TTL applied to candidates/signals whose kind is NULL. */
  ttlDaysForNullKind?: number;
  /** Override "now" for tests. */
  now?: () => Date;
}

export interface ExpireSummary {
  candidates_expired: number;
  signals_cascaded: number;
  workspace_signals_expired: number;
}

function ttlFor(
  kind: string | null,
  opts: { ttlDaysByKind?: Partial<Record<string, number>>; ttlDaysForNullKind?: number },
): number {
  if (kind === null) {
    return opts.ttlDaysForNullKind ?? DEFAULT_NULL_KIND_TTL_DAYS;
  }
  const merged = { ...DEFAULT_KIND_TTL_DAYS, ...(opts.ttlDaysByKind ?? {}) };
  return merged[kind] ?? DEFAULT_NULL_KIND_TTL_DAYS;
}

/**
 * One run of the periodic expiration sweep. Idempotent — repeated runs
 * within the same window are no-ops because they only target rows still
 * in the pre-expired state.
 */
export async function expireOnce(
  deps: ExpireDeps,
  opts: { dryRun?: boolean } = {},
): Promise<ExpireSummary> {
  const summary: ExpireSummary = {
    candidates_expired: 0,
    signals_cascaded: 0,
    workspace_signals_expired: 0,
  };
  const now = deps.now ? deps.now() : new Date();

  // Build the per-kind cutoff list. Each kind maps to a cutoff timestamp;
  // candidates whose freshness_at < cutoff and status='active' get flipped.
  const kindCutoffs: Array<{ kind: string | null; cutoff: Date }> = [];
  for (const kind of Object.keys(DEFAULT_KIND_TTL_DAYS)) {
    kindCutoffs.push({
      kind,
      cutoff: new Date(now.getTime() - ttlFor(kind, deps) * DAY_MS),
    });
  }
  kindCutoffs.push({
    kind: null,
    cutoff: new Date(now.getTime() - ttlFor(null, deps) * DAY_MS),
  });

  // 1. Sweep signal_candidates per kind.
  const expiredCandidateIds: string[] = [];
  for (const { kind, cutoff } of kindCutoffs) {
    const where = kind === null
      ? "kind is null and status = 'active' and freshness_at < $1"
      : "kind = $2::signal_kind and status = 'active' and freshness_at < $1";
    const params = kind === null ? [cutoff] : [cutoff, kind];
    if (opts.dryRun) {
      const { rows } = await deps.pool.query<{ id: string }>(
        `select id from signal_candidates where ${where}`,
        params,
      );
      summary.candidates_expired += rows.length;
      continue;
    }
    const { rows } = await deps.pool.query<{ id: string }>(
      `update signal_candidates
          set status = 'expired', expired_at = now()
        where ${where}
        returning id`,
      params,
    );
    for (const r of rows) expiredCandidateIds.push(r.id);
    summary.candidates_expired += rows.length;
  }

  if (opts.dryRun) {
    // Dry run also estimates the cascade + workspace signal counts.
    let cascaded = 0;
    for (const { kind, cutoff } of kindCutoffs) {
      const where = kind === null
        ? "kind is null and status in ('ingested', 'matched', 'in_play') and freshness_at < $1"
        : "kind = $2::signal_kind and status in ('ingested', 'matched', 'in_play') and freshness_at < $1";
      const params = kind === null ? [cutoff] : [cutoff, kind];
      const { rows } = await deps.pool.query<{ id: string }>(
        `select id from signals where ${where}`,
        params,
      );
      cascaded += rows.length;
    }
    summary.signals_cascaded = cascaded;
    return summary;
  }

  // 2. Cascade: flip workspace signals whose origin_candidate is now expired.
  if (expiredCandidateIds.length > 0) {
    const { rows } = await deps.pool.query<{
      id: string;
      workspace_id: string;
    }>(
      `update signals
          set status = 'spent'
        where origin_candidate_id = any($1::uuid[])
          and status in ('ingested', 'matched', 'in_play')
        returning id, workspace_id`,
      [expiredCandidateIds],
    );
    summary.signals_cascaded = rows.length;
    for (const s of rows) {
      await deps.bus.publish({
        workspace_id: s.workspace_id,
        event_type: "signal.expired",
        source: "system",
        producer_ref: "ingest:expire",
        payload: { signal_id: s.id, reason: "ttl_exceeded" },
      });
    }
  }

  // 3. Sweep workspace signals with no origin_candidate (came from a
  //    workspace adapter) past their kind TTL.
  for (const { kind, cutoff } of kindCutoffs) {
    const where = kind === null
      ? "kind is null and origin_candidate_id is null and status in ('ingested', 'matched', 'in_play') and freshness_at < $1"
      : "kind = $2::signal_kind and origin_candidate_id is null and status in ('ingested', 'matched', 'in_play') and freshness_at < $1";
    const params = kind === null ? [cutoff] : [cutoff, kind];
    const { rows } = await deps.pool.query<{
      id: string;
      workspace_id: string;
    }>(
      `update signals
          set status = 'spent'
        where ${where}
        returning id, workspace_id`,
      params,
    );
    summary.workspace_signals_expired += rows.length;
    for (const s of rows) {
      await deps.bus.publish({
        workspace_id: s.workspace_id,
        event_type: "signal.expired",
        source: "system",
        producer_ref: "ingest:expire",
        payload: { signal_id: s.id, reason: "ttl_exceeded" },
      });
    }
  }

  return summary;
}

/**
 * Durable workflow wrapping expireOnce. Run from a daily trigger; the step
 * is checkpointed so a crash mid-sweep resumes cleanly on retry.
 */
export function createExpireWorkflow(
  deps: ExpireDeps,
): WorkflowDefinition<{ dryRun?: boolean } | undefined, ExpireSummary> {
  return defineWorkflow<{ dryRun?: boolean } | undefined, ExpireSummary>({
    name: "ingest_expire_sweep",
    version: "1",
    async run(input, ctx): Promise<ExpireSummary> {
      return ctx.step(
        "expire_once",
        () => expireOnce(deps, input ?? {}),
        {
          retry: { max_attempts: 3, backoff: "exponential", base_ms: 250 },
          on_failure: "skip",
        },
      );
    },
  });
}

/**
 * Convenience: expose the kind TTL table for the dashboard so it can label
 * "expires in N days" for each candidate.
 */
export function ttlDaysForKind(
  kind: SignalKind | null,
  opts: { ttlDaysByKind?: Partial<Record<string, number>>; ttlDaysForNullKind?: number } = {},
): number {
  return ttlFor(kind, opts);
}
