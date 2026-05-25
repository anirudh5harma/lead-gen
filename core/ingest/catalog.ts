import type { Pool } from "pg";

/**
 * Tracked-companies catalog management. The catalog itself is workspace-
 * agnostic (managed by the platform); workspaces opt in via
 * workspace_tracked_companies, either explicitly or via filter.
 *
 * Catalog discovery (figuring out a company's ATS slug from its domain)
 * is a Phase 1.5 follow-up. Phase 1 manages an explicit catalog seeded
 * by code + the user-facing UI.
 */

export interface TrackedCompany {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  greenhouse_id: string | null;
  lever_id: string | null;
  ashby_id: string | null;
  workable_id: string | null;
  career_rss_url: string | null;
  properties: Record<string, unknown>;
  added_at: string;
}

export interface UpsertTrackedCompanyInput {
  name: string;
  domain?: string;
  industry?: string;
  size_bucket?: string;
  greenhouse_id?: string;
  lever_id?: string;
  ashby_id?: string;
  workable_id?: string;
  career_rss_url?: string;
  properties?: Record<string, unknown>;
}

interface TrackedCompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_bucket: string | null;
  greenhouse_id: string | null;
  lever_id: string | null;
  ashby_id: string | null;
  workable_id: string | null;
  career_rss_url: string | null;
  properties: Record<string, unknown>;
  added_at: Date;
}

function rowToCompany(row: TrackedCompanyRow): TrackedCompany {
  return { ...row, added_at: row.added_at.toISOString() };
}

/**
 * Insert-or-update a catalog company. Domain is the canonical key when
 * present; falls back to (name) when not. The unique index in 015
 * prevents domain duplicates.
 */
export async function upsertTrackedCompany(
  pool: Pool,
  input: UpsertTrackedCompanyInput,
): Promise<TrackedCompany> {
  if (input.domain) {
    const { rows } = await pool.query<TrackedCompanyRow>(
      `insert into tracked_companies (
         name, domain, industry, size_bucket,
         greenhouse_id, lever_id, ashby_id, workable_id, career_rss_url,
         properties, refreshed_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, now())
       on conflict (domain) where domain is not null do update set
         name           = excluded.name,
         industry       = coalesce(excluded.industry, tracked_companies.industry),
         size_bucket    = coalesce(excluded.size_bucket, tracked_companies.size_bucket),
         greenhouse_id  = coalesce(excluded.greenhouse_id, tracked_companies.greenhouse_id),
         lever_id       = coalesce(excluded.lever_id, tracked_companies.lever_id),
         ashby_id       = coalesce(excluded.ashby_id, tracked_companies.ashby_id),
         workable_id    = coalesce(excluded.workable_id, tracked_companies.workable_id),
         career_rss_url = coalesce(excluded.career_rss_url, tracked_companies.career_rss_url),
         properties     = tracked_companies.properties || excluded.properties,
         refreshed_at   = now()
       returning *`,
      [
        input.name,
        input.domain,
        input.industry ?? null,
        input.size_bucket ?? null,
        input.greenhouse_id ?? null,
        input.lever_id ?? null,
        input.ashby_id ?? null,
        input.workable_id ?? null,
        input.career_rss_url ?? null,
        JSON.stringify(input.properties ?? {}),
      ],
    );
    return rowToCompany(rows[0]!);
  }
  // Without a domain, look up by name; insert if missing.
  const existing = await pool.query<TrackedCompanyRow>(
    `select * from tracked_companies where lower(name) = lower($1) limit 1`,
    [input.name],
  );
  if (existing.rows[0]) return rowToCompany(existing.rows[0]);
  const { rows } = await pool.query<TrackedCompanyRow>(
    `insert into tracked_companies (
       name, industry, size_bucket,
       greenhouse_id, lever_id, ashby_id, workable_id, career_rss_url,
       properties, refreshed_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb, now())
     returning *`,
    [
      input.name,
      input.industry ?? null,
      input.size_bucket ?? null,
      input.greenhouse_id ?? null,
      input.lever_id ?? null,
      input.ashby_id ?? null,
      input.workable_id ?? null,
      input.career_rss_url ?? null,
      JSON.stringify(input.properties ?? {}),
    ],
  );
  return rowToCompany(rows[0]!);
}

export async function getTrackedCompany(
  pool: Pool,
  id: string,
): Promise<TrackedCompany | null> {
  const { rows } = await pool.query<TrackedCompanyRow>(
    `select * from tracked_companies where id = $1`,
    [id],
  );
  return rows[0] ? rowToCompany(rows[0]) : null;
}

export async function findTrackedByDomain(
  pool: Pool,
  domain: string,
): Promise<TrackedCompany | null> {
  const { rows } = await pool.query<TrackedCompanyRow>(
    `select * from tracked_companies where domain = $1`,
    [domain],
  );
  return rows[0] ? rowToCompany(rows[0]) : null;
}

/**
 * Return every company in the catalog that has at least one ATS
 * board id of the named kind. The catalog-poll workflows iterate this
 * to know what to poll.
 */
export async function listCatalogForAdapter(
  pool: Pool,
  adapter: "greenhouse" | "lever" | "ashby" | "workable",
  opts: { limit?: number; offset?: number } = {},
): Promise<TrackedCompany[]> {
  const idColumn = `${adapter}_id`;
  const { rows } = await pool.query<TrackedCompanyRow>(
    `select * from tracked_companies
      where ${idColumn} is not null
      order by name asc
      offset $1 limit $2`,
    [opts.offset ?? 0, opts.limit ?? 1000],
  );
  return rows.map(rowToCompany);
}

// ─── Workspace opt-in ─────────────────────────────────────────────────────

export interface AddCompanyByFilter {
  industry?: string[];
  size_bucket?: string[];
  /** Limit how many companies the filter resolves to. */
  limit?: number;
}

export async function addCompanyExplicit(
  pool: Pool,
  workspace_id: string,
  company_id: string,
  reason: string | null = "explicit",
  added_by: string | null = null,
): Promise<void> {
  await pool.query(
    `insert into workspace_tracked_companies (workspace_id, company_id, reason, added_by)
     values ($1, $2, $3, $4)
     on conflict (workspace_id, company_id) do nothing`,
    [workspace_id, company_id, reason, added_by],
  );
}

export async function addCompaniesByFilter(
  pool: Pool,
  workspace_id: string,
  filter: AddCompanyByFilter,
): Promise<TrackedCompany[]> {
  const limit = filter.limit ?? 500;
  const { rows } = await pool.query<TrackedCompanyRow>(
    `select * from tracked_companies
      where ($1::text[] is null or industry    = any($1::text[]))
        and ($2::text[] is null or size_bucket = any($2::text[]))
      order by name asc
      limit $3`,
    [filter.industry ?? null, filter.size_bucket ?? null, limit],
  );
  const reason = `filter:industry=${(filter.industry ?? []).join("+") || "*"}|size=${(filter.size_bucket ?? []).join("+") || "*"}`;
  if (rows.length === 0) return [];
  // Bulk insert opt-ins.
  const values: string[] = [];
  const params: unknown[] = [workspace_id, reason];
  rows.forEach((r, i) => {
    values.push(`($1, $${i + 3}, $2)`);
    params.push(r.id);
  });
  await pool.query(
    `insert into workspace_tracked_companies (workspace_id, company_id, reason)
     values ${values.join(", ")}
     on conflict (workspace_id, company_id) do nothing`,
    params,
  );
  return rows.map(rowToCompany);
}

export async function removeCompany(
  pool: Pool,
  workspace_id: string,
  company_id: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `delete from workspace_tracked_companies
      where workspace_id = $1 and company_id = $2`,
    [workspace_id, company_id],
  );
  return (rowCount ?? 0) > 0;
}

export async function listWorkspaceCompanies(
  pool: Pool,
  workspace_id: string,
): Promise<TrackedCompany[]> {
  const { rows } = await pool.query<TrackedCompanyRow>(
    `select tc.* from tracked_companies tc
       join workspace_tracked_companies wtc on wtc.company_id = tc.id
      where wtc.workspace_id = $1
      order by tc.name asc`,
    [workspace_id],
  );
  return rows.map(rowToCompany);
}

/**
 * Which workspaces have this company opted in? Used by the catalog-poll
 * fanout step: when a new candidate lands for company X, look up the
 * interested workspaces and fan out.
 */
export async function findWorkspacesTrackingCompany(
  pool: Pool,
  company_id: string,
): Promise<string[]> {
  const { rows } = await pool.query<{ workspace_id: string }>(
    `select workspace_id from workspace_tracked_companies where company_id = $1`,
    [company_id],
  );
  return rows.map((r) => r.workspace_id);
}
