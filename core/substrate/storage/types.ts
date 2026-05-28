/**
 * Storage layer types. The substrate uses raw Postgres (via `pg`) rather
 * than an ORM — we keep the database knowledge in SQL files
 * (db/migrations/) and let TypeScript talk to it through small, typed
 * wrappers.
 *
 * Production swap-points: any of these interfaces can be re-implemented
 * against a different driver (Neon HTTP, PgBouncer, etc.) without changing
 * call sites.
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export type { Pool, PoolClient, QueryResult, QueryResultRow };

/**
 * A workspace-scoped session. Every query inside `withWorkspace` runs in a
 * transaction with the JWT claim set so RLS helpers
 * (`current_user_id`, `is_workspace_member`) evaluate against the caller.
 */
export interface WorkspaceSession {
  workspace_id: string;
  user_id: string;
}

/**
 * The subset of `pg.PoolClient` we care about. Useful for typing the
 * callback that `withWorkspace` hands you.
 */
export interface TenantClient {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<QueryResult<R>>;
}
