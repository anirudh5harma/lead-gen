import type { Pool } from "pg";
import type {
  MemoryScope,
  ProceduralAdd,
  ProceduralExemplar,
  ProceduralOutcomeUpdate,
  ProceduralRepository,
} from "../types.ts";

/**
 * Postgres-backed procedural memory. THE MOAT.
 *
 * Stores winning exemplars per `pattern_key` (e.g.
 * "icp:fintech-founder|signal:series_a|stage:cold_open"). The hot-path
 * judge retrieves the top-N for the current pattern as few-shot examples.
 * Outcomes update the score:
 *   - `applyOutcome({ delta_score, win: true })` bumps win_count + score
 *   - `applyOutcome({ delta_score, win: false })` bumps loss_count + adds
 *     a negative delta_score
 *
 * This is where the system actually compounds. Every positive reply makes
 * the next draft a little better.
 */

interface PostgresProceduralOptions {
  pool: Pool;
}

interface ProceduralRow {
  id: string;
  rep_id: string;
  workspace_id: string;
  pattern_key: string;
  exemplar: Record<string, unknown>;
  score: string;
  win_count: number;
  loss_count: number;
  last_used_at: Date | null;
}

function rowToExemplar(row: ProceduralRow): ProceduralExemplar {
  return {
    id: row.id,
    rep_id: row.rep_id,
    workspace_id: row.workspace_id,
    pattern_key: row.pattern_key,
    exemplar: row.exemplar ?? {},
    score: Number(row.score),
    win_count: row.win_count,
    loss_count: row.loss_count,
    last_used_at: row.last_used_at?.toISOString() ?? null,
  };
}

export function createPostgresProceduralRepository(
  opts: PostgresProceduralOptions,
): ProceduralRepository {
  const { pool } = opts;
  return {
    async add(scope: MemoryScope, entry: ProceduralAdd): Promise<ProceduralExemplar> {
      const { rows } = await pool.query<ProceduralRow>(
        `insert into rep_memory_procedural (
           workspace_id, rep_id, pattern_key, exemplar, score
         ) values ($1, $2, $3, $4::jsonb, $5)
         returning id, workspace_id, rep_id, pattern_key, exemplar,
                   score::text as score, win_count, loss_count, last_used_at`,
        [
          scope.workspace_id,
          scope.rep_id,
          entry.pattern_key,
          JSON.stringify(entry.exemplar),
          entry.initial_score ?? 0.5,
        ],
      );
      return rowToExemplar(rows[0]!);
    },

    async topForPattern(
      scope: MemoryScope,
      pattern_key: string,
      limit = 5,
    ): Promise<ProceduralExemplar[]> {
      const { rows } = await pool.query<ProceduralRow>(
        `select id, workspace_id, rep_id, pattern_key, exemplar,
                score::text as score, win_count, loss_count, last_used_at
           from rep_memory_procedural
          where workspace_id = $1 and rep_id = $2 and pattern_key = $3
          order by score desc, last_used_at desc nulls last
          limit $4`,
        [scope.workspace_id, scope.rep_id, pattern_key, limit],
      );
      return rows.map(rowToExemplar);
    },

    async applyOutcome(
      scope: MemoryScope,
      exemplar_ids: string[],
      update: ProceduralOutcomeUpdate,
    ): Promise<void> {
      if (exemplar_ids.length === 0) return;
      // Score is clamped to [0, 1] in code; the column itself is numeric(5,4)
      // and would otherwise tolerate drift outside the intended range.
      await pool.query(
        `update rep_memory_procedural
            set score        = least(1.0, greatest(0.0, score + $3::numeric)),
                win_count    = win_count  + case when $4 then 1 else 0 end,
                loss_count   = loss_count + case when $4 then 0 else 1 end,
                last_used_at = now()
          where workspace_id = $1
            and rep_id = $2
            and pattern_key = $5
            and id = any($6::uuid[])`,
        [
          scope.workspace_id,
          scope.rep_id,
          update.delta_score,
          update.win,
          update.pattern_key,
          exemplar_ids,
        ],
      );
    },
  };
}
