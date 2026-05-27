/**
 * Shared helpers for DB-backed tests. Each suite gets its own freshly
 * migrated schema so RLS / cross-suite state doesn't bleed.
 *
 * If `DATABASE_URL` is unset the helper returns `null`; suites should
 * `t.skip()` in that case so `npm test` still passes in a no-DB environment.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "../db/runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "..", "db", "migrations");

export interface PgFixture {
  pool: pg.Pool;
  schema: string;
  close(): Promise<void>;
}

/**
 * Spin up a uniquely-named Postgres schema, apply all migrations into it,
 * and hand back a pool whose search_path points at it. Closing the fixture
 * drops the schema.
 */
export async function setupPg(label = "t"): Promise<PgFixture | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  await ensureTestExtensions(connectionString);

  const schema = `bs_${label}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  // Bootstrap connection (default search_path) — create the schema, then
  // hand the rest off to a pool scoped to it.
  const bootstrap = new pg.Client({ connectionString });
  await bootstrap.connect();
  try {
    await bootstrap.query(`create schema "${schema}"`);
  } finally {
    await bootstrap.end();
  }

  const pool = new pg.Pool({
    connectionString,
    max: 4,
    options: `-c search_path=${schema},public`,
  });

  await runMigrations({ pool, dir: migrationsDir });

  return {
    pool,
    schema,
    async close() {
      await pool.end();
      const cleanup = new pg.Client({ connectionString });
      await cleanup.connect();
      try {
        await cleanup.query(`drop schema "${schema}" cascade`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

async function ensureTestExtensions(connectionString: string): Promise<void> {
  const bootstrap = new pg.Client({ connectionString });
  await bootstrap.connect();
  try {
    await bootstrap.query("select pg_advisory_lock(hashtext('bombsell_test_extensions'))");
    await bootstrap.query("create extension if not exists pgcrypto with schema public");
    await bootstrap.query("create extension if not exists citext with schema public");
    await bootstrap.query("create extension if not exists vector with schema public");
  } finally {
    await bootstrap.query("select pg_advisory_unlock(hashtext('bombsell_test_extensions'))");
    await bootstrap.end();
  }
}

/** Helper for tests that need to wait for an async condition. */
export async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 3000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const v = await predicate();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, interval));
  }
}
