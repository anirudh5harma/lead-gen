import type { Pool, PoolClient } from "pg";
import type { CompanyUpsert, GraphCompany } from "../types.ts";
import { formatVector } from "../_vector.ts";
import { normalizeCompanyDomain } from "../../ingest/company-domain.ts";

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
  const normalizedDomain = normalizeCompanyDomain(input.domain ?? null) ?? null;
  const embedding = formatVector(input.embedding);
  const client = await pool.connect();

  try {
    await client.query("begin");

    if (normalizedDomain) {
      const canonical = await upsertCompanyWithDomain(client, workspace_id, {
        ...input,
        domain: normalizedDomain,
      }, embedding);
      await client.query("commit");
      return canonical;
    }

    const existing = await client.query<CompanyRow>(
      `select * from graph_companies
        where workspace_id = $1 and lower(name) = lower($2)
        order by created_at asc
        limit 1`,
      [workspace_id, input.name],
    );
    if (existing.rows[0]) {
      const updated = await updateCompanyRow(client, existing.rows[0].id, {
        ...input,
        domain: undefined,
      }, embedding);
      await client.query("commit");
      return updated;
    }

    const { rows } = await client.query<CompanyRow>(
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
    await client.query("commit");
    return rowToCompany(rows[0]!);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
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
  const normalizedDomain = normalizeCompanyDomain(domain);
  if (!normalizedDomain) return null;
  const { rows } = await pool.query<CompanyRow>(
    `select * from graph_companies where workspace_id = $1 and domain = $2`,
    [workspace_id, normalizedDomain],
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

export async function deleteCompany(
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
            (from_node_type = 'company' and from_node_id = $2)
            or (to_node_type = 'company' and to_node_id = $2)
          )`,
      [workspace_id, id],
    );
    const result = await client.query(
      `delete from graph_companies where workspace_id = $1 and id = $2`,
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

type DbClient = Pool | PoolClient;

async function upsertCompanyWithDomain(
  client: DbClient,
  workspace_id: string,
  input: CompanyUpsert & { domain: string },
  embedding: string | null,
): Promise<GraphCompany> {
  const existingByDomain = await client.query<CompanyRow>(
    `select * from graph_companies
      where workspace_id = $1
        and domain = $2
      order by created_at asc
      limit 1`,
    [workspace_id, input.domain],
  );
  if (existingByDomain.rows[0]) {
    const updated = await updateCompanyRow(client, existingByDomain.rows[0].id, input, embedding);
    await collapseCompanyDuplicates(client, workspace_id, updated, input.name);
    return reloadCompany(client, workspace_id, updated.id);
  }

  const aliasMatch = await client.query<CompanyRow>(
    `select * from graph_companies
      where workspace_id = $1
        and (
          lower(name) = lower($2)
          or (
            domain is not null
            and domain::text like '%.' || $3
          )
        )
      order by
        case when domain is null then 1 else 0 end,
        created_at asc
      limit 1`,
    [workspace_id, input.name, input.domain],
  );
  if (aliasMatch.rows[0]) {
    const updated = await updateCompanyRow(client, aliasMatch.rows[0].id, input, embedding);
    await collapseCompanyDuplicates(client, workspace_id, updated, input.name);
    return reloadCompany(client, workspace_id, updated.id);
  }

  const { rows } = await client.query<CompanyRow>(
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

async function updateCompanyRow(
  client: DbClient,
  id: string,
  input: CompanyUpsert,
  embedding: string | null,
): Promise<GraphCompany> {
  const { rows } = await client.query<CompanyRow>(
    `update graph_companies set
       name        = $2,
       domain      = coalesce($3::citext, domain),
       industry    = coalesce($4, industry),
       size_bucket = coalesce($5, size_bucket),
       description = coalesce($6, description),
       properties  = properties || $7::jsonb,
       provenance  = provenance || $8::jsonb,
       embedding   = coalesce($9::vector, embedding),
       embedded_at = case when $9::vector is not null then now() else embedded_at end,
       updated_at  = now()
     where id = $1
     returning *`,
    [
      id,
      input.name,
      input.domain ?? null,
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

async function collapseCompanyDuplicates(
  client: DbClient,
  workspace_id: string,
  canonical: GraphCompany,
  requestedName: string,
): Promise<void> {
  if (!canonical.domain) return;
  const { rows: duplicates } = await client.query<CompanyRow>(
    `select * from graph_companies
      where workspace_id = $1
        and id <> $2
        and (
          lower(name) = lower($3)
          or (
            domain is not null
            and (
              domain = $4
              or domain::text like '%.' || $4
            )
          )
        )
      order by created_at asc`,
    [workspace_id, canonical.id, requestedName, canonical.domain],
  );
  if (duplicates.length === 0) return;

  const duplicateIds = duplicates.map((row) => row.id);
  for (const duplicate of duplicates) {
    await client.query(
      `update graph_companies
          set properties = properties || $2::jsonb,
              provenance = provenance || $3::jsonb,
              description = coalesce(description, $4),
              industry = coalesce(industry, $5),
              size_bucket = coalesce(size_bucket, $6),
              updated_at = now()
        where workspace_id = $1
          and id = $7`,
      [
        workspace_id,
        JSON.stringify(duplicate.properties ?? {}),
        JSON.stringify(duplicate.provenance ?? {}),
        duplicate.description,
        duplicate.industry,
        duplicate.size_bucket,
        canonical.id,
      ],
    );
  }

  await client.query(
    `update signals
        set related_company_id = $2
      where workspace_id = $1
        and related_company_id = any($3::uuid[])`,
    [workspace_id, canonical.id, duplicateIds],
  );
  await client.query(
    `update graph_persons
        set company_id = $2
      where workspace_id = $1
        and company_id = any($3::uuid[])`,
    [workspace_id, canonical.id, duplicateIds],
  );
  await client.query(
    `update conversations
        set counterparty_company_id = $2
      where workspace_id = $1
        and counterparty_company_id = any($3::uuid[])`,
    [workspace_id, canonical.id, duplicateIds],
  );
  await client.query(
    `update outcomes
        set subject_company_id = $2
      where workspace_id = $1
        and subject_company_id = any($3::uuid[])`,
    [workspace_id, canonical.id, duplicateIds],
  );
  await client.query(
    `insert into graph_edges (
       workspace_id,
       from_node_type,
       from_node_id,
       to_node_type,
       to_node_id,
       edge_type,
       properties,
       provenance
     )
     select workspace_id,
            from_node_type,
            case
              when from_node_type = 'company' and from_node_id = any($3::uuid[]) then $2::uuid
              else from_node_id
            end,
            to_node_type,
            case
              when to_node_type = 'company' and to_node_id = any($3::uuid[]) then $2::uuid
              else to_node_id
            end,
            edge_type,
            properties,
            provenance
       from graph_edges
      where workspace_id = $1
        and (
          (from_node_type = 'company' and from_node_id = any($3::uuid[]))
          or (to_node_type = 'company' and to_node_id = any($3::uuid[]))
        )
     on conflict (
       workspace_id,
       from_node_type,
       from_node_id,
       edge_type,
       to_node_type,
       to_node_id
     ) do update set
       properties = graph_edges.properties || excluded.properties,
       provenance = graph_edges.provenance || excluded.provenance`,
    [workspace_id, canonical.id, duplicateIds],
  );
  await client.query(
    `delete from graph_edges
      where workspace_id = $1
        and (
          (from_node_type = 'company' and from_node_id = any($2::uuid[]))
          or (to_node_type = 'company' and to_node_id = any($2::uuid[]))
        )`,
    [workspace_id, duplicateIds],
  );
  await client.query(
    `delete from graph_companies
      where workspace_id = $1
        and id = any($2::uuid[])`,
    [workspace_id, duplicateIds],
  );
}

async function reloadCompany(
  client: DbClient,
  workspace_id: string,
  id: string,
): Promise<GraphCompany> {
  const { rows } = await client.query<CompanyRow>(
    `select * from graph_companies
      where workspace_id = $1
        and id = $2`,
    [workspace_id, id],
  );
  return rowToCompany(rows[0]!);
}
