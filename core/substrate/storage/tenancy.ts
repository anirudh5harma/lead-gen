import type { Pool, PoolClient } from "pg";
import type { TenantClient, WorkspaceSession } from "./types.ts";

/**
 * Workspace-scoped session. Runs `fn` inside a transaction with the JWT
 * claim that the RLS helpers (`current_user_id`, `is_workspace_member`)
 * evaluate against. Verifies workspace membership before doing any user
 * work, so callers don't have to.
 *
 * Use this for ALL request-time queries that should be RLS-enforced.
 * System code (event bus, workflow runtime, migrations) uses `pool.query`
 * directly — it runs as the connecting role (which should NOT be a member
 * of every workspace; it bypasses RLS via SUPERUSER / BYPASSRLS in prod, or
 * via being the system role in dev).
 *
 * Example:
 *   await withWorkspace(pool, { workspace_id, user_id }, async (db) => {
 *     const { rows } = await db.query<Lead>("select * from leads limit 50");
 *     return rows;
 *   });
 */
export async function withWorkspace<T>(
  pool: Pool,
  session: WorkspaceSession,
  fn: (db: TenantClient) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("begin");
    // `request.jwt.claim.sub` is what `current_user_id()` reads in the RLS
    // helpers (see db/migrations/001_extensions_and_tenancy.sql). Use SET
    // LOCAL so the setting evaporates with the transaction.
    await client.query(
      `select set_config('request.jwt.claim.sub', $1, true)`,
      [session.user_id],
    );

    // Cheap membership check before doing any work. Rejecting early gives
    // callers a typed error instead of an opaque RLS denial deep in a query.
    const { rows } = await client.query<{ ok: boolean }>(
      "select is_workspace_member($1) as ok",
      [session.workspace_id],
    );
    if (!rows[0]?.ok) {
      throw new WorkspaceMembershipError(session);
    }

    const result = await fn(client as unknown as TenantClient);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      /* ignore — already failed */
    }
    throw err;
  } finally {
    client.release();
  }
}

export class WorkspaceMembershipError extends Error {
  readonly workspace_id: string;
  readonly user_id: string;
  constructor(session: WorkspaceSession) {
    super(
      `User ${session.user_id} is not a member of workspace ${session.workspace_id}`,
    );
    this.workspace_id = session.workspace_id;
    this.user_id = session.user_id;
    this.name = "WorkspaceMembershipError";
  }
}
