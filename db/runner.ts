import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

export const REQUIRED_MIGRATION_FILES = [
  "044_trial_credits.sql",
] as const;

/**
 * Minimal Postgres migration runner. Reads *.sql files from a directory,
 * applies them in filename order (so the `001_`, `002_`, … prefix
 * controls sequence), and records each in `schema_migrations` so it never
 * runs twice.
 *
 * Each migration runs in its own transaction. If a migration fails, the
 * runner aborts; previously-applied files are not rolled back.
 *
 * Checksums are recorded so that an applied migration whose file has
 * changed since is detected loudly — silent schema drift is a leading
 * cause of "works on my machine" outages.
 */

export interface MigrationResult {
  filename: string;
  status: "applied" | "skipped" | "checksum_mismatch";
  duration_ms: number;
}

export interface RunMigrationsOptions {
  pool: Pool;
  dir: string;
  /** If true, do not actually apply; just report what would change. */
  dryRun?: boolean;
  /** Test harnesses can adapt schema-qualified SQL while keeping file checksums stable. */
  sqlTransform?: (input: { filename: string; sql: string }) => string;
}

export async function runMigrations(
  opts: RunMigrationsOptions,
): Promise<MigrationResult[]> {
  await ensureMigrationsTable(opts.pool);
  const applied = await loadApplied(opts.pool);
  const files = (await readdir(opts.dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  assertRequiredMigrationFiles(files);

  const results: MigrationResult[] = [];
  for (const filename of files) {
    const fullPath = path.join(opts.dir, filename);
    const rawSql = await readFile(fullPath, "utf8");
    const checksum = sha256(rawSql);
    const sql = opts.sqlTransform?.({ filename, sql: rawSql }) ?? rawSql;
    const priorChecksum = applied.get(filename);

    if (priorChecksum && priorChecksum !== checksum) {
      results.push({
        filename,
        status: "checksum_mismatch",
        duration_ms: 0,
      });
      throw new MigrationChecksumMismatchError(filename, priorChecksum, checksum);
    }

    if (priorChecksum) {
      results.push({ filename, status: "skipped", duration_ms: 0 });
      continue;
    }

    if (opts.dryRun) {
      results.push({ filename, status: "applied", duration_ms: 0 });
      continue;
    }

    const started = Date.now();
    const client = await opts.pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(
        "insert into schema_migrations (filename, checksum) values ($1, $2)",
        [filename, checksum],
      );
      await client.query("commit");
    } catch (err) {
      try {
        await client.query("rollback");
      } catch {
        /* ignore */
      }
      throw new MigrationFailedError(filename, err);
    } finally {
      client.release();
    }
    results.push({
      filename,
      status: "applied",
      duration_ms: Date.now() - started,
    });
  }
  return results;
}

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(
    `create table if not exists schema_migrations (
       filename   text primary key,
       checksum   text not null,
       applied_at timestamptz not null default now()
     )`,
  );
}

async function loadApplied(pool: Pool): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ filename: string; checksum: string }>(
    "select filename, checksum from schema_migrations",
  );
  return new Map(rows.map((r) => [r.filename, r.checksum]));
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function assertRequiredMigrationFiles(files: string[]): void {
  for (const filename of REQUIRED_MIGRATION_FILES) {
    if (!files.includes(filename)) {
      throw new Error(
        `Missing required migration '${filename}' from ${files.length} discovered SQL files`,
      );
    }
  }
}

export class MigrationChecksumMismatchError extends Error {
  readonly filename: string;
  readonly prior: string;
  readonly current: string;
  constructor(filename: string, prior: string, current: string) {
    super(
      `Migration '${filename}' was previously applied with checksum ${prior.slice(0, 12)}… but the file now hashes to ${current.slice(0, 12)}…. Refusing to proceed; create a new migration instead of editing applied SQL.`,
    );
    this.filename = filename;
    this.prior = prior;
    this.current = current;
    this.name = "MigrationChecksumMismatchError";
  }
}

export class MigrationFailedError extends Error {
  readonly filename: string;
  readonly cause: unknown;
  constructor(filename: string, cause: unknown) {
    super(
      `Migration '${filename}' failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.filename = filename;
    this.cause = cause;
    this.name = "MigrationFailedError";
  }
}

/**
 * Acquire a client and ensure the pool is reachable. Returns the client.
 * Useful for test setup.
 */
export async function verifyConnection(pool: Pool): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query("select 1");
  return client;
}
