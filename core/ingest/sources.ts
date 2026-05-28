import type { Pool } from "pg";

/**
 * Platform-level signal source registry. One row per adapter
 * implementation (greenhouse, lever, ashby, workable, sec_edgar, ...).
 * The catalog poll workflow looks up the source id by adapter name and
 * iterates tracked_companies that have that adapter's board id.
 */

export interface PlatformSignalSource {
  id: string;
  adapter: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

interface PlatformSignalSourceRow {
  id: string;
  adapter: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: Date;
}

function rowToSource(row: PlatformSignalSourceRow): PlatformSignalSource {
  return { ...row, created_at: row.created_at.toISOString() };
}

export async function ensurePlatformSource(
  pool: Pool,
  adapter: string,
  name: string,
  config: Record<string, unknown> = {},
): Promise<PlatformSignalSource> {
  const { rows } = await pool.query<PlatformSignalSourceRow>(
    `insert into platform_signal_sources (adapter, name, config)
       values ($1, $2, $3::jsonb)
       on conflict (adapter) do update
         set name   = excluded.name,
             config = platform_signal_sources.config || excluded.config
       returning *`,
    [adapter, name, JSON.stringify(config)],
  );
  return rowToSource(rows[0]!);
}

export async function getPlatformSourceByAdapter(
  pool: Pool,
  adapter: string,
): Promise<PlatformSignalSource | null> {
  const { rows } = await pool.query<PlatformSignalSourceRow>(
    `select * from platform_signal_sources where adapter = $1`,
    [adapter],
  );
  return rows[0] ? rowToSource(rows[0]) : null;
}

export async function listPlatformSources(
  pool: Pool,
  opts: { only_enabled?: boolean } = {},
): Promise<PlatformSignalSource[]> {
  const { rows } = opts.only_enabled
    ? await pool.query<PlatformSignalSourceRow>(
        `select * from platform_signal_sources where enabled order by adapter asc`,
      )
    : await pool.query<PlatformSignalSourceRow>(
        `select * from platform_signal_sources order by adapter asc`,
      );
  return rows.map(rowToSource);
}

// ─── Catalog poll cursor management ───────────────────────────────────────

export interface CatalogCursor {
  cursor: Record<string, unknown>;
  last_polled_at: string | null;
  last_error: Record<string, unknown> | null;
  last_external_ids: string[];
}

export async function loadCursor(
  pool: Pool,
  source_id: string,
  company_id: string,
): Promise<CatalogCursor> {
  const { rows } = await pool.query<{
    cursor: Record<string, unknown>;
    last_polled_at: Date | null;
    last_error: Record<string, unknown> | null;
    last_external_ids: string[];
  }>(
    `select cursor, last_polled_at, last_error, last_external_ids
       from catalog_poll_cursors
      where source_id = $1 and company_id = $2`,
    [source_id, company_id],
  );
  const row = rows[0];
  if (!row) {
    return { cursor: {}, last_polled_at: null, last_error: null, last_external_ids: [] };
  }
  return {
    cursor: row.cursor ?? {},
    last_polled_at: row.last_polled_at?.toISOString() ?? null,
    last_error: row.last_error,
    last_external_ids: row.last_external_ids ?? [],
  };
}

export async function saveCursor(
  pool: Pool,
  source_id: string,
  company_id: string,
  cursor: Record<string, unknown>,
  external_ids: string[],
): Promise<void> {
  await pool.query(
    `insert into catalog_poll_cursors (
       source_id, company_id, cursor, last_polled_at, last_external_ids, last_error
     ) values ($1, $2, $3::jsonb, now(), $4, null)
     on conflict (source_id, company_id) do update set
       cursor            = excluded.cursor,
       last_polled_at    = excluded.last_polled_at,
       last_external_ids = excluded.last_external_ids,
       last_error        = null`,
    [source_id, company_id, JSON.stringify(cursor), external_ids],
  );
}

export async function recordCursorError(
  pool: Pool,
  source_id: string,
  company_id: string,
  error: unknown,
): Promise<void> {
  const payload =
    error instanceof Error
      ? { message: error.message, name: error.name }
      : { message: String(error) };
  await pool.query(
    `insert into catalog_poll_cursors (
       source_id, company_id, last_polled_at, last_error
     ) values ($1, $2, now(), $3::jsonb)
     on conflict (source_id, company_id) do update set
       last_polled_at = now(),
       last_error     = excluded.last_error`,
    [source_id, company_id, JSON.stringify(payload)],
  );
}
