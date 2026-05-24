import type { Pool } from "pg";
import { formatVector } from "../../../graph/_vector.ts";
import type {
  EpisodicAppend,
  EpisodicEntry,
  EpisodicQuery,
  EpisodicRepository,
  MemoryScope,
} from "../types.ts";

/**
 * Postgres-backed episodic memory. Append-only journal of every raw
 * interaction (messages, retrievals, decisions). The replay tape.
 *
 * The `embedding` field is optional. Callers that have an embedding ready
 * pass it via `refs._embedding`; otherwise rows go in un-embedded and a
 * later backfill job (when the LLM client lands) populates them. We split
 * "embedding" out of `refs` rather than burying it inside so the column
 * stays typed.
 */

interface PostgresEpisodicOptions {
  pool: Pool;
}

interface EpisodicRow {
  id: string;
  rep_id: string;
  workspace_id: string;
  kind: string;
  content: string;
  refs: Record<string, unknown> | null;
  occurred_at: Date;
}

function rowToEntry(row: EpisodicRow): EpisodicEntry {
  return {
    id: row.id,
    rep_id: row.rep_id,
    workspace_id: row.workspace_id,
    kind: row.kind,
    content: row.content,
    refs: row.refs ?? {},
    occurred_at: row.occurred_at.toISOString(),
  };
}

export function createPostgresEpisodicRepository(
  opts: PostgresEpisodicOptions,
): EpisodicRepository {
  const { pool } = opts;
  return {
    async append(scope: MemoryScope, entry: EpisodicAppend): Promise<EpisodicEntry> {
      const embedding =
        entry.refs && "_embedding" in entry.refs
          ? formatVector(entry.refs._embedding as number[])
          : null;
      const refsWithoutEmbedding: Record<string, unknown> = { ...(entry.refs ?? {}) };
      delete refsWithoutEmbedding._embedding;

      const { rows } = await pool.query<EpisodicRow>(
        `insert into rep_memory_episodic (
           workspace_id, rep_id, kind, content, refs, occurred_at, embedding
         ) values ($1, $2, $3, $4, $5::jsonb, coalesce($6::timestamptz, now()), $7::vector)
         returning id, workspace_id, rep_id, kind, content, refs, occurred_at`,
        [
          scope.workspace_id,
          scope.rep_id,
          entry.kind,
          entry.content,
          JSON.stringify(refsWithoutEmbedding),
          entry.occurred_at ?? null,
          embedding,
        ],
      );
      return rowToEntry(rows[0]!);
    },

    async recent(scope: MemoryScope, query?: EpisodicQuery): Promise<EpisodicEntry[]> {
      const limit = query?.limit ?? 50;
      const since = query?.since ?? null;
      const kinds = query?.kinds && query.kinds.length > 0 ? query.kinds : null;

      const { rows } = await pool.query<EpisodicRow>(
        `select id, workspace_id, rep_id, kind, content, refs, occurred_at
           from rep_memory_episodic
          where workspace_id = $1
            and rep_id = $2
            and ($3::timestamptz is null or occurred_at >= $3::timestamptz)
            and ($4::text[] is null or kind = any($4::text[]))
          order by occurred_at desc
          limit $5`,
        [scope.workspace_id, scope.rep_id, since, kinds, limit],
      );
      return rows.map(rowToEntry);
    },

    async search(
      scope: MemoryScope,
      query: string,
      limit = 25,
    ): Promise<EpisodicEntry[]> {
      // Trigram-ish substring match for foundation. When the LLM client
      // lands and rows have embeddings, replace with a vector_cosine_ops
      // nearest-neighbour query.
      const { rows } = await pool.query<EpisodicRow>(
        `select id, workspace_id, rep_id, kind, content, refs, occurred_at
           from rep_memory_episodic
          where workspace_id = $1 and rep_id = $2
            and content ilike '%' || $3 || '%'
          order by occurred_at desc
          limit $4`,
        [scope.workspace_id, scope.rep_id, query, limit],
      );
      return rows.map(rowToEntry);
    },
  };
}
