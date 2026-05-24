import { test } from "node:test";
import assert from "node:assert/strict";
import { setupPg } from "./_pg.ts";

test("migration runner: applies all foundation migrations and creates expected tables", async (t) => {
  const fx = await setupPg("runner");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const expected = [
      "workspaces",
      "workspace_members",
      "events",
      "workflow_runs",
      "workflow_steps",
      "workflow_checkpoints",
      "workflow_approvals",
      "graph_companies",
      "graph_persons",
      "graph_sources",
      "graph_edges",
      "signals",
      "conversations",
      "messages",
      "reps",
      "rep_memory_episodic",
      "rep_memory_semantic",
      "rep_memory_procedural",
      "plays",
      "play_runs",
      "outcomes",
      "channel_accounts",
      "sending_domains",
    ];
    const { rows } = await fx.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = $1 and table_type = 'BASE TABLE'`,
      [fx.schema],
    );
    const present = new Set(rows.map((r) => r.table_name));
    for (const name of expected) {
      assert.ok(present.has(name), `expected table ${name}`);
    }
  } finally {
    await fx.close();
  }
});

test("migration runner: detects checksum drift on a previously-applied file", async (t) => {
  const fx = await setupPg("checksum");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    // Tamper with one row to fake a drifted checksum.
    await fx.pool.query(
      `update schema_migrations set checksum = 'deadbeef'
        where filename = '001_extensions_and_tenancy.sql'`,
    );

    const { runMigrations, MigrationChecksumMismatchError } = await import(
      "../db/runner.ts"
    );
    const path = await import("node:path");
    const url = await import("node:url");
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(__dirname, "..", "db", "migrations");

    await assert.rejects(
      runMigrations({ pool: fx.pool, dir: migrationsDir }),
      (err: unknown) => err instanceof MigrationChecksumMismatchError,
    );
  } finally {
    await fx.close();
  }
});

test("migration runner: re-run on a clean DB is a no-op for applied files", async (t) => {
  const fx = await setupPg("idempo");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const path = await import("node:path");
    const url = await import("node:url");
    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const migrationsDir = path.resolve(__dirname, "..", "db", "migrations");
    const { runMigrations } = await import("../db/runner.ts");

    const results = await runMigrations({ pool: fx.pool, dir: migrationsDir });
    assert.ok(results.every((r) => r.status === "skipped"));
  } finally {
    await fx.close();
  }
});
