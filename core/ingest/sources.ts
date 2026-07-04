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

export async function updatePlatformSourceRuntimeState(
  pool: Pool,
  source_id: string,
  runtimeState: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `update platform_signal_sources
        set config = jsonb_set(
          coalesce(config, '{}'::jsonb),
          '{runtime_state}',
          $2::jsonb,
          true
        )
      where id = $1`,
    [source_id, JSON.stringify(runtimeState)],
  );
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

// ─── Workspace source health ─────────────────────────────────────────────

export interface StaleSource {
  source_id: string;
  workspace_id: string;
  name: string;
  adapter: string | null;
  last_polled_at: string | null;
  last_error: Record<string, unknown> | null;
  produced_7d: number;
}

/**
 * Returns workspace sources that look unhealthy: enabled but either
 * (a) have never polled successfully in the last poll window,
 * (b) hold a `last_error`, or
 * (c) produced zero signals in the past 7 days.
 *
 * UI uses this to surface "why aren't signals appearing?" without needing
 * an operator to grep worker logs.
 */
export async function getStaleSources(
  pool: Pool,
  workspace_id: string,
): Promise<StaleSource[]> {
  const { rows } = await pool.query<{
    source_id: string;
    workspace_id: string;
    name: string;
    adapter: string | null;
    last_polled_at: Date | null;
    last_error: Record<string, unknown> | null;
    produced_7d: string;
  }>(
    `select gs.id                                     as source_id,
            gs.workspace_id                           as workspace_id,
            gs.name                                   as name,
            coalesce(gs.config->>'adapter', gs.kind::text) as adapter,
            wsc.last_polled_at                        as last_polled_at,
            wsc.last_error                            as last_error,
            (
              select count(*)::text
                from signals s
               where s.workspace_id = gs.workspace_id
                 and s.source_id = gs.id
                 and coalesce(s.ingested_at, s.freshness_at)
                     >= now() - interval '7 days'
            ) as produced_7d
       from graph_sources gs
       join workspace_source_configs wsc
         on wsc.workspace_id = gs.workspace_id
        and wsc.source_id = gs.id
      where gs.workspace_id = $1
        and gs.enabled
        and wsc.enabled
        and (
          wsc.last_polled_at is null
          or wsc.last_polled_at
             <= now() - (wsc.poll_cadence_sec * interval '1 second') * 2
          or wsc.last_error is not null
          or (
            select count(*)
              from signals s
             where s.workspace_id = gs.workspace_id
               and s.source_id = gs.id
               and coalesce(s.ingested_at, s.freshness_at)
                   >= now() - interval '7 days'
          ) = 0
        )
      order by wsc.last_polled_at asc nulls first, gs.name asc
      limit 50`,
    [workspace_id],
  );
  return rows.map((row) => ({
    source_id: row.source_id,
    workspace_id: row.workspace_id,
    name: row.name,
    adapter: row.adapter,
    last_polled_at: row.last_polled_at ? row.last_polled_at.toISOString() : null,
    last_error: row.last_error,
    produced_7d: Number(row.produced_7d ?? 0),
  }));
}

/**
 * Cheap "does the workspace have any enabled signal source at all?" probe.
 * Used by the dashboard self-heal path to decide whether to trigger default
 * seeding when a workspace has none — e.g., because activation setup died
 * mid-run and never emitted `workspace.source.configured`.
 */
export async function hasEnabledSignalSource(
  pool: Pool,
  workspace_id: string,
): Promise<boolean> {
  const { rows } = await pool.query<{ has_source: boolean }>(
    `select exists (
       select 1
         from graph_sources gs
         join workspace_source_configs wsc
           on wsc.workspace_id = gs.workspace_id and wsc.source_id = gs.id
        where gs.workspace_id = $1
          and gs.enabled
          and wsc.enabled
     ) as has_source`,
    [workspace_id],
  );
  return rows[0]?.has_source === true;
}
