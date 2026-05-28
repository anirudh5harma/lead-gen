import type { Pool } from "pg";
import type {
  MemoryScope,
  SemanticEntry,
  SemanticRepository,
  SemanticSubjectType,
  SemanticUpsert,
} from "../types.ts";

/**
 * Postgres-backed semantic memory. Deduped facts about people, companies,
 * or signals — keyed by (workspace, rep, subject_type, subject_id).
 *
 * Upsert semantics: `facts` are merged at the top level via jsonb
 * concatenation (existing keys are replaced; new keys are added). Use
 * structured facts (e.g. `{ "title": "CEO", "champion_for": "ProductX" }`)
 * to make the merge meaningful.
 */

interface PostgresSemanticOptions {
  pool: Pool;
}

interface SemanticRow {
  id: string;
  rep_id: string;
  workspace_id: string;
  subject_type: SemanticSubjectType;
  subject_id: string;
  facts: Record<string, unknown> | null;
  confidence: string | null;
  last_observed_at: Date;
}

function rowToEntry(row: SemanticRow): SemanticEntry {
  return {
    id: row.id,
    rep_id: row.rep_id,
    workspace_id: row.workspace_id,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    facts: row.facts ?? {},
    confidence: row.confidence != null ? Number(row.confidence) : null,
    last_observed_at: row.last_observed_at.toISOString(),
  };
}

export function createPostgresSemanticRepository(
  opts: PostgresSemanticOptions,
): SemanticRepository {
  const { pool } = opts;
  return {
    async upsert(scope: MemoryScope, entry: SemanticUpsert): Promise<SemanticEntry> {
      const { rows } = await pool.query<SemanticRow>(
        `insert into rep_memory_semantic (
           workspace_id, rep_id, subject_type, subject_id,
           facts, confidence, last_observed_at
         ) values ($1, $2, $3, $4, $5::jsonb, $6, now())
         on conflict (workspace_id, rep_id, subject_type, subject_id) do update set
           facts            = rep_memory_semantic.facts || excluded.facts,
           confidence       = coalesce(excluded.confidence, rep_memory_semantic.confidence),
           last_observed_at = now()
         returning id, workspace_id, rep_id, subject_type, subject_id,
                   facts, confidence::text as confidence, last_observed_at`,
        [
          scope.workspace_id,
          scope.rep_id,
          entry.subject_type,
          entry.subject_id,
          JSON.stringify(entry.facts ?? {}),
          entry.confidence ?? null,
        ],
      );
      return rowToEntry(rows[0]!);
    },

    async get(
      scope: MemoryScope,
      subject_type: SemanticSubjectType,
      subject_id: string,
    ): Promise<SemanticEntry | null> {
      const { rows } = await pool.query<SemanticRow>(
        `select id, workspace_id, rep_id, subject_type, subject_id,
                facts, confidence::text as confidence, last_observed_at
           from rep_memory_semantic
          where workspace_id = $1 and rep_id = $2
            and subject_type = $3 and subject_id = $4`,
        [scope.workspace_id, scope.rep_id, subject_type, subject_id],
      );
      return rows[0] ? rowToEntry(rows[0]) : null;
    },

    async forSubjects(
      scope: MemoryScope,
      subjects: Array<{ type: SemanticSubjectType; id: string }>,
    ): Promise<SemanticEntry[]> {
      if (subjects.length === 0) return [];
      // Build a (type, id) tuple list so a single query covers many
      // (heterogeneous) subjects.
      const types = subjects.map((s) => s.type);
      const ids = subjects.map((s) => s.id);
      const { rows } = await pool.query<SemanticRow>(
        `select id, workspace_id, rep_id, subject_type, subject_id,
                facts, confidence::text as confidence, last_observed_at
           from rep_memory_semantic
          where workspace_id = $1 and rep_id = $2
            and (subject_type, subject_id) = any(
              select * from unnest($3::text[], $4::uuid[])
            )`,
        [scope.workspace_id, scope.rep_id, types, ids],
      );
      return rows.map(rowToEntry);
    },
  };
}
