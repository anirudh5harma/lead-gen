import pg from "pg";
import type { Pool, PoolConfig } from "pg";

/**
 * Singleton Postgres pool. Most call sites should use `getPool()` to share
 * the process-wide pool; tests construct their own via `createPool({...})`.
 *
 * Connection: defaults to `DATABASE_URL`. If unset, returns null from
 * `tryGetPool()` (so optional code paths can degrade gracefully) and throws
 * from `getPool()`.
 */

let _pool: Pool | null = null;

export function createPool(config: PoolConfig): Pool {
  const pool = new pg.Pool(config);
  // Surface unhandled idle-client errors so they don't crash the process
  // silently. Real handling (re-create pool, alert) lives in production
  // adapters layered above.
  pool.on("error", (err) => {
    console.error("[storage] idle pool client error:", err);
  });
  return pool;
}

export function setPool(pool: Pool): void {
  _pool = pool;
}

export function tryGetPool(): Pool | null {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  _pool = createPool({
    connectionString,
    // Reasonable defaults; tune via env when the production deployment lands.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return _pool;
}

export function getPool(): Pool {
  const pool = tryGetPool();
  if (!pool) {
    throw new Error(
      "DATABASE_URL is not set. The substrate storage layer needs a Postgres connection string.",
    );
  }
  return pool;
}

/**
 * Test helper: close + clear the singleton so a fresh `getPool()` reads
 * env again. Safe to call even if no pool was created.
 */
export async function resetPool(): Promise<void> {
  const pool = _pool;
  _pool = null;
  if (pool) await pool.end();
}
