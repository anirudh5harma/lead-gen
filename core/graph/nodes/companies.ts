import type { Pool } from "pg";
import type { CompanyUpsert, GraphCompany } from "../types.ts";
import { formatVector } from "../_vector.ts";

/**
 * Company node operations. `upsertCompany` is the canonical entry point:
 * pass a domain and the row is created or updated in place. Without a
 * domain we match on (workspace, lower(name)) — weaker, but the best we
 * can do for nameless rows.
 *
 * Embeddings: optional. If supplied, the row's `embedding` + `embedded_at`
 * are updated atomically. Otherwise they're left as-is on update.
 */

interface CompanyRow {
  id: string;
  workspace_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  description: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  embedded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToCompany(row: CompanyRow): GraphCompany {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    size_bucket: row.size_bucket,
    description: row.description,
    properties: row.properties ?? {},
    provenance: row.provenance ?? {},
    embedded_at: row.embedded_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function upsertCompany(
  pool: Pool,
  workspace_id: string,
  input: CompanyUpsert,
): Promise<GraphCompany> {
  const embedding = formatVector(input.embedding);

  if (input.domain) {
    // Domain-keyed upsert via the unique index.
    const { rows } = await pool.query<CompanyRow>(
      `insert into graph_companies (
         workspace_id, name, domain, industry, size_bucket, description,
         properties, provenance, embedding, embedded_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb,
         $9::vector, case when $9::vector is null then null else now() end,
         now()
       )
       on conflict (workspace_id, domain) where domain is not null
       do update set
         name        = excluded.name,
         industry    = coalesce(excluded.industry, graph_companies.industry),
         size_bucket = coalesce(excluded.size_bucket, graph_companies.size_bucket),
         description = coalesce(excluded.description, graph_companies.description),
         properties  = graph_companies.properties || excluded.properties,
         provenance  = excluded.provenance,
         embedding   = coalesce(excluded.embedding, graph_companies.embedding),
         embedded_at = case when excluded.embedding is not null then now() else graph_companies.embedded_at end,
         updated_at  = now()
       returning *`,
      [
        workspace_id,
        input.name,
        input.domain,
        input.industry ?? null,
        input.size_bucket ?? null,
        input.description ?? null,
        JSON.stringify(input.properties ?? {}),
        JSON.stringify(input.provenance ?? {}),
        embedding,
      ],
    );
    return rowToCompany(rows[0]!);
  }

  // No domain: name-based fallback. Single SELECT-then-UPSERT round-trip.
  const existing = await pool.query<CompanyRow>(
    `select * from graph_companies
      where workspace_id = $1 and lower(name) = lower($2)
      order by created_at asc
      limit 1`,
    [workspace_id, input.name],
  );
  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    const { rows } = await pool.query<CompanyRow>(
      `update graph_companies set
         name        = $2,
         industry    = coalesce($3, industry),
         size_bucket = coalesce($4, size_bucket),
         description = coalesce($5, description),
         properties  = properties || $6::jsonb,
         provenance  = $7::jsonb,
         embedding   = coalesce($8::vector, embedding),
         embedded_at = case when $8::vector is not null then now() else embedded_at end,
         updated_at  = now()
       where id = $1
       returning *`,
      [
        id,
        input.name,
        input.industry ?? null,
        input.size_bucket ?? null,
        input.description ?? null,
        JSON.stringify(input.properties ?? {}),
        JSON.stringify(input.provenance ?? {}),
        embedding,
      ],
    );
    return rowToCompany(rows[0]!);
  }

  const { rows } = await pool.query<CompanyRow>(
    `insert into graph_companies (
       workspace_id, name, industry, size_bucket, description,
       properties, provenance, embedding, embedded_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb,
       $8::vector, case when $8::vector is null then null else now() end,
       now()
     ) returning *`,
    [
      workspace_id,
      input.name,
      input.industry ?? null,
      input.size_bucket ?? null,
      input.description ?? null,
      JSON.stringify(input.properties ?? {}),
      JSON.stringify(input.provenance ?? {}),
      embedding,
    ],
  );
  return rowToCompany(rows[0]!);
}

export async function getCompany(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<GraphCompany | null> {
  const { rows } = await pool.query<CompanyRow>(
    `select * from graph_companies where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ? rowToCompany(rows[0]) : null;
}

export async function findCompanyByDomain(
  pool: Pool,
  workspace_id: string,
  domain: string,
): Promise<GraphCompany | null> {
  const { rows } = await pool.query<CompanyRow>(
    `select * from graph_companies where workspace_id = $1 and domain = $2`,
    [workspace_id, domain],
  );
  return rows[0] ? rowToCompany(rows[0]) : null;
}

export async function listCompaniesByName(
  pool: Pool,
  workspace_id: string,
  name: string,
  limit = 25,
): Promise<GraphCompany[]> {
  const { rows } = await pool.query<CompanyRow>(
    `select * from graph_companies
      where workspace_id = $1 and lower(name) like '%' || lower($2) || '%'
      order by name asc
      limit $3`,
    [workspace_id, name, limit],
  );
  return rows.map(rowToCompany);
}
