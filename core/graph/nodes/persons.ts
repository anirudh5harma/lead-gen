import type { Pool } from "pg";
import type { GraphPerson, PersonUpsert } from "../types.ts";
import { formatVector } from "../_vector.ts";

/**
 * Person node operations. Key precedence on upsert:
 *
 *   1. linkedin_url (when present) — strongest signal of identity
 *   2. emails[] (overlap)         — common case for outreach pipelines
 *   3. (company_id, full_name)    — fallback when only a CRM row is known
 *
 * Emails are stored as `citext[]`. Upsert merges new emails into the
 * existing array (deduped, case-insensitive) rather than replacing.
 */

interface PersonRow {
  id: string;
  workspace_id: string;
  full_name: string;
  given_name: string | null;
  family_name: string | null;
  title: string | null;
  company_id: string | null;
  emails: string[];
  phones: string[];
  linkedin_url: string | null;
  x_handle: string | null;
  properties: Record<string, unknown>;
  provenance: Record<string, unknown>;
  embedded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToPerson(row: PersonRow): GraphPerson {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    full_name: row.full_name,
    given_name: row.given_name,
    family_name: row.family_name,
    title: row.title,
    company_id: row.company_id,
    emails: row.emails ?? [],
    phones: row.phones ?? [],
    linkedin_url: row.linkedin_url,
    x_handle: row.x_handle,
    properties: row.properties ?? {},
    provenance: row.provenance ?? {},
    embedded_at: row.embedded_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

async function locateExisting(
  pool: Pool,
  workspace_id: string,
  input: PersonUpsert,
): Promise<string | null> {
  if (input.linkedin_url) {
    const { rows } = await pool.query<{ id: string }>(
      `select id from graph_persons
        where workspace_id = $1 and linkedin_url = $2
        limit 1`,
      [workspace_id, input.linkedin_url],
    );
    if (rows[0]) return rows[0].id;
  }
  if (input.emails && input.emails.length > 0) {
    const { rows } = await pool.query<{ id: string }>(
      `select id from graph_persons
        where workspace_id = $1 and emails && $2::citext[]
        order by created_at asc
        limit 1`,
      [workspace_id, input.emails],
    );
    if (rows[0]) return rows[0].id;
  }
  if (input.company_id) {
    const { rows } = await pool.query<{ id: string }>(
      `select id from graph_persons
        where workspace_id = $1 and company_id = $2 and lower(full_name) = lower($3)
        limit 1`,
      [workspace_id, input.company_id, input.full_name],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

export async function upsertPerson(
  pool: Pool,
  workspace_id: string,
  input: PersonUpsert,
): Promise<GraphPerson> {
  const embedding = formatVector(input.embedding);
  const existingId = await locateExisting(pool, workspace_id, input);

  if (existingId) {
    const { rows } = await pool.query<PersonRow>(
      `update graph_persons set
         full_name    = $2,
         given_name   = coalesce($3, given_name),
         family_name  = coalesce($4, family_name),
         title        = coalesce($5, title),
         company_id   = coalesce($6, company_id),
         -- merge emails: union of existing and new, citext dedup.
         emails       = (
           select coalesce(array_agg(distinct e), array[]::citext[])
             from unnest(graph_persons.emails || $7::citext[]) as e
         ),
         phones       = (
           select coalesce(array_agg(distinct p), array[]::text[])
             from unnest(graph_persons.phones || $8::text[]) as p
         ),
         linkedin_url = coalesce($9, linkedin_url),
         x_handle     = coalesce($10, x_handle),
         properties   = properties || $11::jsonb,
         provenance   = $12::jsonb,
         embedding    = coalesce($13::vector, embedding),
         embedded_at  = case when $13::vector is not null then now() else embedded_at end,
         updated_at   = now()
       where id = $1
       returning id, workspace_id, full_name, given_name, family_name, title,
                 company_id,
                 emails::text[] as emails, phones,
                 linkedin_url, x_handle::text as x_handle,
                 properties, provenance, embedded_at, created_at, updated_at`,
      [
        existingId,
        input.full_name,
        input.given_name ?? null,
        input.family_name ?? null,
        input.title ?? null,
        input.company_id ?? null,
        input.emails ?? [],
        input.phones ?? [],
        input.linkedin_url ?? null,
        input.x_handle ?? null,
        JSON.stringify(input.properties ?? {}),
        JSON.stringify(input.provenance ?? {}),
        embedding,
      ],
    );
    return rowToPerson(rows[0]!);
  }

  const { rows } = await pool.query<PersonRow>(
    `insert into graph_persons (
       workspace_id, full_name, given_name, family_name, title, company_id,
       emails, phones, linkedin_url, x_handle,
       properties, provenance, embedding, embedded_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6,
       $7::citext[], $8::text[], $9, $10,
       $11::jsonb, $12::jsonb,
       $13::vector, case when $13::vector is null then null else now() end,
       now()
     ) returning id, workspace_id, full_name, given_name, family_name, title,
                 company_id,
                 emails::text[] as emails, phones,
                 linkedin_url, x_handle::text as x_handle,
                 properties, provenance, embedded_at, created_at, updated_at`,
    [
      workspace_id,
      input.full_name,
      input.given_name ?? null,
      input.family_name ?? null,
      input.title ?? null,
      input.company_id ?? null,
      input.emails ?? [],
      input.phones ?? [],
      input.linkedin_url ?? null,
      input.x_handle ?? null,
      JSON.stringify(input.properties ?? {}),
      JSON.stringify(input.provenance ?? {}),
      embedding,
    ],
  );
  return rowToPerson(rows[0]!);
}

export async function getPerson(
  pool: Pool,
  workspace_id: string,
  id: string,
): Promise<GraphPerson | null> {
  const { rows } = await pool.query<PersonRow>(
    `select id, workspace_id, full_name, given_name, family_name, title,
            company_id,
            emails::text[] as emails, phones,
            linkedin_url, x_handle::text as x_handle,
            properties, provenance, embedded_at, created_at, updated_at
       from graph_persons where workspace_id = $1 and id = $2`,
    [workspace_id, id],
  );
  return rows[0] ? rowToPerson(rows[0]) : null;
}

export async function findPersonByEmail(
  pool: Pool,
  workspace_id: string,
  email: string,
): Promise<GraphPerson | null> {
  const { rows } = await pool.query<PersonRow>(
    `select id, workspace_id, full_name, given_name, family_name, title,
            company_id,
            emails::text[] as emails, phones,
            linkedin_url, x_handle::text as x_handle,
            properties, provenance, embedded_at, created_at, updated_at
       from graph_persons
      where workspace_id = $1 and emails @> array[$2]::citext[]
      order by created_at asc
      limit 1`,
    [workspace_id, email],
  );
  return rows[0] ? rowToPerson(rows[0]) : null;
}

export async function findPersonByLinkedIn(
  pool: Pool,
  workspace_id: string,
  linkedin_url: string,
): Promise<GraphPerson | null> {
  const { rows } = await pool.query<PersonRow>(
    `select id, workspace_id, full_name, given_name, family_name, title,
            company_id,
            emails::text[] as emails, phones,
            linkedin_url, x_handle::text as x_handle,
            properties, provenance, embedded_at, created_at, updated_at
       from graph_persons
      where workspace_id = $1 and linkedin_url = $2
      limit 1`,
    [workspace_id, linkedin_url],
  );
  return rows[0] ? rowToPerson(rows[0]) : null;
}

export async function listPersonsForCompany(
  pool: Pool,
  workspace_id: string,
  company_id: string,
  limit = 50,
): Promise<GraphPerson[]> {
  const { rows } = await pool.query<PersonRow>(
    `select id, workspace_id, full_name, given_name, family_name, title,
            company_id,
            emails::text[] as emails, phones,
            linkedin_url, x_handle::text as x_handle,
            properties, provenance, embedded_at, created_at, updated_at
       from graph_persons
      where workspace_id = $1 and company_id = $2
      order by full_name asc
      limit $3`,
    [workspace_id, company_id, limit],
  );
  return rows.map(rowToPerson);
}
