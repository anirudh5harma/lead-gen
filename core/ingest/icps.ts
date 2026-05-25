import { z } from "zod";
import type { Pool } from "pg";

/**
 * Workspace ICP segment CRUD. Team plan exposes the UI; foundation code
 * uses these helpers directly.
 *
 * The matcher iterates a workspace's enabled ICPs and tries each
 * candidate against the must_haves predicate (cheap, structured —
 * core/ingest/icp-filter.ts) before any LLM scoring.
 */

export const IcpPredicateRule = z.object({
  /** Dotted path: `kind`, `company.industry`, `structured.seniority`, ... */
  field: z.string().min(1),
  op: z.enum(["in", "eq", "gte", "lte", "contains", "not_in", "matches"]),
  value: z.unknown(),
});
export type IcpPredicateRule = z.infer<typeof IcpPredicateRule>;

export const IcpInput = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  must_haves: z.array(IcpPredicateRule).default([]),
  nice_to_haves: z.array(z.string()).default([]),
  match_threshold: z.number().min(0).max(1).default(0.6),
  enabled: z.boolean().default(true),
});
export type IcpInput = z.infer<typeof IcpInput>;

export const IcpRow = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  name: z.string(),
  description: z.string(),
  must_haves: z.array(IcpPredicateRule),
  nice_to_haves: z.array(z.string()),
  match_threshold: z.number(),
  enabled: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type IcpRow = z.infer<typeof IcpRow>;

interface IcpDbRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  must_haves: unknown;
  nice_to_haves: unknown;
  match_threshold: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function rowToIcp(row: IcpDbRow): IcpRow {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    description: row.description,
    must_haves: Array.isArray(row.must_haves)
      ? (row.must_haves as IcpPredicateRule[])
      : [],
    nice_to_haves: Array.isArray(row.nice_to_haves)
      ? (row.nice_to_haves as string[])
      : [],
    match_threshold: Number(row.match_threshold),
    enabled: row.enabled,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listIcps(
  pool: Pool,
  workspace_id: string,
  opts: { only_enabled?: boolean } = {},
): Promise<IcpRow[]> {
  const { rows } = opts.only_enabled
    ? await pool.query<IcpDbRow>(
        `select * from workspace_icps where workspace_id = $1 and enabled order by name asc`,
        [workspace_id],
      )
    : await pool.query<IcpDbRow>(
        `select * from workspace_icps where workspace_id = $1 order by name asc`,
        [workspace_id],
      );
  return rows.map(rowToIcp);
}

export async function getIcp(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<IcpRow | null> {
  const { rows } = await pool.query<IcpDbRow>(
    `select * from workspace_icps where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ? rowToIcp(rows[0]) : null;
}

export async function createIcp(
  pool: Pool,
  workspace_id: string,
  input: IcpInput,
): Promise<IcpRow> {
  const parsed = IcpInput.parse(input);
  const { rows } = await pool.query<IcpDbRow>(
    `insert into workspace_icps (
       workspace_id, name, description, must_haves, nice_to_haves,
       match_threshold, enabled
     ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     returning *`,
    [
      workspace_id,
      parsed.name,
      parsed.description,
      JSON.stringify(parsed.must_haves),
      JSON.stringify(parsed.nice_to_haves),
      parsed.match_threshold,
      parsed.enabled,
    ],
  );
  return rowToIcp(rows[0]!);
}

export async function updateIcp(
  pool: Pool,
  workspace_id: string,
  id: string,
  input: Partial<IcpInput>,
): Promise<IcpRow | null> {
  const fields: string[] = [];
  const values: unknown[] = [workspace_id, id];
  let idx = 3;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (key === "must_haves" || key === "nice_to_haves") {
      fields.push(`${key} = $${idx}::jsonb`);
      values.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = $${idx}`);
      values.push(value);
    }
    idx += 1;
  }
  if (fields.length === 0) return getIcp(pool, workspace_id, id);
  fields.push(`updated_at = now()`);
  const { rows } = await pool.query<IcpDbRow>(
    `update workspace_icps set ${fields.join(", ")}
      where workspace_id = $1 and id = $2
      returning *`,
    values,
  );
  return rows[0] ? rowToIcp(rows[0]) : null;
}

export async function deleteIcp(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from workspace_icps where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return (rowCount ?? 0) > 0;
}
