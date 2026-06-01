import type { Pool } from "pg";
import type { GraphSource, SourceUpsert } from "../types.ts";

/**
 * Source node operations. Sources are the origins of signals + content
 * inspiration: GDELT queries, RSS feeds, HN, Product Hunt, monitored
 * companies, etc. Identity key is (workspace, kind, name).
 */

interface SourceRow {
  id: string;
  workspace_id: string;
  kind: GraphSource["kind"];
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  last_polled_at: Date | null;
  properties: Record<string, unknown>;
  created_at: Date;
}

function rowToSource(row: SourceRow): GraphSource {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    kind: row.kind,
    name: row.name,
    config: row.config ?? {},
    enabled: row.enabled,
    last_polled_at: row.last_polled_at?.toISOString() ?? null,
    properties: row.properties ?? {},
    created_at: row.created_at.toISOString(),
  };
}

export async function upsertSource(
  pool: Pool,
  workspace_id: string,
  input: SourceUpsert,
): Promise<GraphSource> {
  const existing = await pool.query<SourceRow>(
    `select * from graph_sources
      where workspace_id = $1 and kind = $2 and name = $3
      limit 1`,
    [workspace_id, input.kind, input.name],
  );
  if (existing.rows[0]) {
    const { rows } = await pool.query<SourceRow>(
      `update graph_sources set
         config     = $2::jsonb,
         enabled    = coalesce($3, enabled),
         properties = properties || $4::jsonb
       where id = $1
       returning *`,
      [
        existing.rows[0].id,
        JSON.stringify(input.config ?? {}),
        input.enabled ?? null,
        JSON.stringify(input.properties ?? {}),
      ],
    );
    return rowToSource(rows[0]!);
  }
  const { rows } = await pool.query<SourceRow>(
    `insert into graph_sources (
       workspace_id, kind, name, config, enabled, properties
     ) values (
       $1, $2, $3, $4::jsonb, coalesce($5, true), $6::jsonb
     ) returning *`,
    [
      workspace_id,
      input.kind,
      input.name,
      JSON.stringify(input.config ?? {}),
      input.enabled ?? null,
      JSON.stringify(input.properties ?? {}),
    ],
  );
  return rowToSource(rows[0]!);
}

export async function getSource(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<GraphSource | null> {
  const { rows } = await pool.query<SourceRow>(
    `select * from graph_sources where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ? rowToSource(rows[0]) : null;
}

export async function listSources(
  pool: Pool,
  workspace_id: string,
  kind?: GraphSource["kind"],
): Promise<GraphSource[]> {
  const { rows } = kind
    ? await pool.query<SourceRow>(
        `select * from graph_sources
          where workspace_id = $1 and kind = $2
          order by name asc`,
        [workspace_id, kind],
      )
    : await pool.query<SourceRow>(
        `select * from graph_sources
          where workspace_id = $1
          order by kind asc, name asc`,
        [workspace_id],
      );
  return rows.map(rowToSource);
}

export async function markSourcePolled(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<void> {
  await pool.query(
    `update graph_sources set last_polled_at = now()
      where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
}

export async function deleteSource(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `delete from graph_edges
        where workspace_id = $1
          and (
            (from_node_type = 'source' and from_node_id = $2)
            or (to_node_type = 'source' and to_node_id = $2)
          )`,
      [workspace_id, id],
    );
    const result = await client.query(
      `delete from graph_sources where workspace_id = $1 and id = $2`,
      [workspace_id, id],
    );
    await client.query("commit");
    return (result.rowCount ?? 0) > 0;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
