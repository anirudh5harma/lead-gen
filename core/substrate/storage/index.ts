/**
 * Storage layer — raw Postgres (pg) with workspace-scoped sessions.
 *
 *   System mode (no RLS): import { getPool } from "@/core/substrate/storage";
 *                         await getPool().query("...");
 *
 *   User mode (RLS):      import { withWorkspace } from "@/core/substrate/storage";
 *                         await withWorkspace(pool, { workspace_id, user_id }, async (db) => {
 *                           // queries here are RLS-enforced
 *                         });
 */

export * from "./types.ts";
export {
  createPool,
  getPool,
  isTransientConnectionError,
  resetPool,
  setPool,
  tryGetPool,
  withTransientConnectionRetry,
} from "./pool.ts";
export { withWorkspace, WorkspaceMembershipError } from "./tenancy.ts";
