#!/usr/bin/env node
/**
 * Migration CLI. Apply db/migrations/*.sql in order against $DATABASE_URL.
 *
 *   npm run migrate            apply all pending migrations
 *   npm run migrate -- --dry   list what would be applied without applying
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../core/substrate/storage/pool.ts";
import { runMigrations } from "../db/runner.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "..", "db", "migrations");

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry");
  const pool = createPool({ connectionString });

  try {
    const results = await runMigrations({
      pool,
      dir: migrationsDir,
      dryRun,
    });

    const applied = results.filter((r) => r.status === "applied");
    const skipped = results.filter((r) => r.status === "skipped");

    for (const r of applied) {
      console.log(`${dryRun ? "would apply" : "applied "} ${r.filename}` +
        (dryRun ? "" : ` (${r.duration_ms}ms)`));
    }
    console.log(
      `${applied.length} ${dryRun ? "pending" : "applied"}, ${skipped.length} already in place`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
