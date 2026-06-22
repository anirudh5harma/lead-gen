#!/usr/bin/env node
/**
 * Review low-yield workspace signal sources and optionally disable sources
 * that have produced no signals in the lookback window.
 *
 * Usage:
 *   npm run tune:signal-sources -- --dry-run
 *   npm run tune:signal-sources -- --apply-disable --days=14
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { getPool } from "../core/substrate/storage/index.ts";

interface SourceRow {
  workspace_id: string;
  source_id: string;
  adapter: string;
  source_name: string;
  enabled: boolean;
  last_polled_at: Date | null;
  signals_last_window: number;
  matched_last_window: number;
}

loadDotenvLocal();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");

  const pool = getPool();
  const rows = await listSourcePerformance(pool, args.days);
  const recommendations = rows.map((row) => ({
    ...row,
    action: recommendAction(row),
  }));

  if (args.applyDisable) {
    for (const row of recommendations) {
      if (row.action !== "disable") continue;
      await pool.query(
        `update graph_sources set enabled = false where workspace_id = $1 and id = $2`,
        [row.workspace_id, row.source_id],
      );
      await pool.query(
        `update workspace_source_configs set enabled = false where workspace_id = $1 and source_id = $2`,
        [row.workspace_id, row.source_id],
      );
    }
  }

  console.log(JSON.stringify({
    ok: true,
    dry_run: !args.applyDisable,
    lookback_days: args.days,
    inspected: recommendations.length,
    disables: recommendations.filter((row) => row.action === "disable").length,
    watches: recommendations.filter((row) => row.action === "watch").length,
    keeps: recommendations.filter((row) => row.action === "keep").length,
    recommendations,
  }, null, 2));
}

async function listSourcePerformance(pool: ReturnType<typeof getPool>, days: number): Promise<SourceRow[]> {
  const { rows } = await pool.query<SourceRow>(
    `select
        gs.workspace_id::text as workspace_id,
        gs.id::text as source_id,
        coalesce(gs.config->>'adapter', gs.kind::text, 'unknown') as adapter,
        gs.name as source_name,
        gs.enabled,
        gs.last_polled_at,
        count(s.*)::int as signals_last_window,
        count(s.*) filter (where s.status = 'matched')::int as matched_last_window
       from graph_sources gs
       left join signals s
         on s.workspace_id = gs.workspace_id
        and s.source_id = gs.id
        and s.ingested_at >= now() - ($1::int * interval '1 day')
      where coalesce(gs.config->>'adapter', gs.kind::text, 'unknown') in ('google_news', 'rss', 'exa')
      group by gs.workspace_id, gs.id, adapter, gs.name, gs.enabled, gs.last_polled_at
      order by adapter asc, signals_last_window asc, matched_last_window asc, gs.name asc`,
    [days],
  );
  return rows;
}

function recommendAction(row: SourceRow): "keep" | "watch" | "disable" {
  if (!row.enabled) return "keep";
  if (row.signals_last_window === 0) return "disable";
  if (row.matched_last_window === 0) return "watch";
  return "keep";
}

function parseArgs(argv: string[]): {
  days: number;
  applyDisable: boolean;
} {
  let days = 14;
  let applyDisable = false;
  for (const arg of argv) {
    if (arg === "--dry-run") continue;
    if (arg === "--apply-disable") {
      applyDisable = true;
      continue;
    }
    if (arg.startsWith("--days=")) {
      const value = Number(arg.slice("--days=".length));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--days must be a positive integer");
      }
      days = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { days, applyDisable };
}

function loadDotenvLocal(): void {
  if (!fs.existsSync(".env.local")) return;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
