import type { Pool } from "pg";

/**
 * Daily ingestion budgets. Two counters per workspace:
 *
 *   candidate_used  — bumped by stage 1 for every survivor of dedup.
 *                     Throttles cheap polling; overflow rows go to
 *                     `signal_overflow` so we don't lose them silently.
 *   classify_used   — bumped by stage 2 for every LLM-bearing batch.
 *                     Throttles expensive classification.
 *
 * Both reset on a rolling 24-hour window relative to `window_start`.
 * Atomic increment-with-check is done via SQL so concurrent pollers
 * can't double-spend the budget.
 */

export interface BudgetState {
  workspace_id: string;
  daily_candidate_cap: number;
  daily_classify_cap: number;
  daily_candidates_used: number;
  daily_classify_used: number;
  window_start: string;
}

/**
 * Ensure a workspace_ingestion_budgets row exists, with defaults from
 * the schema. Called once at workspace setup and idempotent thereafter.
 */
export async function ensureBudgetRow(
  pool: Pool,
  workspace_id: string,
): Promise<BudgetState> {
  const { rows } = await pool.query<{
    workspace_id: string;
    daily_candidate_cap: number;
    daily_classify_cap: number;
    daily_candidates_used: number;
    daily_classify_used: number;
    window_start: Date;
  }>(
    `insert into workspace_ingestion_budgets (workspace_id)
       values ($1)
       on conflict (workspace_id) do update
         set window_start = workspace_ingestion_budgets.window_start
       returning workspace_id, daily_candidate_cap, daily_classify_cap,
                 daily_candidates_used, daily_classify_used, window_start`,
    [workspace_id],
  );
  const row = rows[0]!;
  return {
    workspace_id: row.workspace_id,
    daily_candidate_cap: row.daily_candidate_cap,
    daily_classify_cap: row.daily_classify_cap,
    daily_candidates_used: row.daily_candidates_used,
    daily_classify_used: row.daily_classify_used,
    window_start: row.window_start.toISOString(),
  };
}

/**
 * Atomic reserve-one-candidate. Rolls the 24h window over if expired,
 * then conditionally increments. Returns true on success, false when
 * the cap is already hit.
 */
export async function reserveCandidate(
  pool: Pool,
  workspace_id: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ reserved: boolean }>(
    `update workspace_ingestion_budgets b
        set daily_candidates_used = case
              when b.window_start < now() - interval '24 hours' then 1
              else b.daily_candidates_used + 1
            end,
            daily_classify_used = case
              when b.window_start < now() - interval '24 hours' then 0
              else b.daily_classify_used
            end,
            window_start = case
              when b.window_start < now() - interval '24 hours' then now()
              else b.window_start
            end
      where b.workspace_id = $1
        and (
              b.window_start < now() - interval '24 hours'
           OR b.daily_candidates_used < b.daily_candidate_cap
        )
      returning true as reserved`,
    [workspace_id],
  );
  return Boolean(rows[0]?.reserved);
}

/**
 * Same for classify. Stage 2 reserves before issuing the LLM batch.
 */
export async function reserveClassify(
  pool: Pool,
  workspace_id: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ reserved: boolean }>(
    `update workspace_ingestion_budgets b
        set daily_classify_used = case
              when b.window_start < now() - interval '24 hours' then 1
              else b.daily_classify_used + 1
            end,
            daily_candidates_used = case
              when b.window_start < now() - interval '24 hours' then 0
              else b.daily_candidates_used
            end,
            window_start = case
              when b.window_start < now() - interval '24 hours' then now()
              else b.window_start
            end
      where b.workspace_id = $1
        and (
              b.window_start < now() - interval '24 hours'
           OR b.daily_classify_used < b.daily_classify_cap
        )
      returning true as reserved`,
    [workspace_id],
  );
  return Boolean(rows[0]?.reserved);
}

/**
 * Refund a previously reserved candidate slot (e.g., when a transient
 * provider error means we couldn't store the row after all). Never
 * goes negative.
 */
export async function refundCandidate(
  pool: Pool,
  workspace_id: string,
): Promise<void> {
  await pool.query(
    `update workspace_ingestion_budgets
        set daily_candidates_used = greatest(0, daily_candidates_used - 1)
      where workspace_id = $1`,
    [workspace_id],
  );
}

/**
 * Record an audit row when an item couldn't be ingested because a cap
 * was hit (or some other reason). Prevents silent data loss.
 */
export async function recordOverflow(
  pool: Pool,
  workspace_id: string,
  source_id: string | null,
  reason: string,
  payload: unknown,
): Promise<void> {
  await pool.query(
    `insert into signal_overflow (workspace_id, source_id, reason, payload)
     values ($1, $2, $3, $4::jsonb)`,
    [workspace_id, source_id, reason, JSON.stringify(payload ?? {})],
  );
}

export async function readBudget(
  pool: Pool,
  workspace_id: string,
): Promise<BudgetState | null> {
  const { rows } = await pool.query<{
    workspace_id: string;
    daily_candidate_cap: number;
    daily_classify_cap: number;
    daily_candidates_used: number;
    daily_classify_used: number;
    window_start: Date;
  }>(
    `select workspace_id, daily_candidate_cap, daily_classify_cap,
            daily_candidates_used, daily_classify_used, window_start
       from workspace_ingestion_budgets where workspace_id = $1`,
    [workspace_id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    window_start: row.window_start.toISOString(),
  };
}
