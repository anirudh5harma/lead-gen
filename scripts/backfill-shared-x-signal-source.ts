#!/usr/bin/env node
/**
 * Ensure the pooled platform-wide X source exists with a shared low-cost rule
 * pack. This keeps X acquisition shared across workspaces instead of polling
 * identical searches per workspace.
 *
 * Usage:
 *   npm run backfill:shared-x-signal-source -- --dry-run
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  SHARED_X_SOURCE_ADAPTER,
  defaultSharedXSourceConfig,
  sharedXMonthlyCostEstimateUsd,
} from "../core/ingest/index.ts";
import {
  ensurePlatformSource,
  getPlatformSourceByAdapter,
} from "../core/ingest/sources.ts";
import { getPool } from "../core/substrate/storage/index.ts";

loadDotenvLocal();

async function main(): Promise<void> {
  const dryRun = process.argv.slice(2).includes("--dry-run");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");

  const pool = getPool();
  const existing = await getPlatformSourceByAdapter(pool, SHARED_X_SOURCE_ADAPTER);
  const config = defaultSharedXSourceConfig();
  const estimate = sharedXMonthlyCostEstimateUsd(config);

  if (estimate > config.monthly_budget_usd) {
    throw new Error(
      `Default shared X config projects $${estimate}/mo which exceeds the budget cap of $${config.monthly_budget_usd}/mo`,
    );
  }

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      exists: Boolean(existing),
      adapter: SHARED_X_SOURCE_ADAPTER,
      projected_monthly_cost_usd: estimate,
      monthly_budget_usd: config.monthly_budget_usd,
      rule_count: config.rules.length,
    }, null, 2));
    return;
  }

  const source = await ensurePlatformSource(
    pool,
    SHARED_X_SOURCE_ADAPTER,
    "Shared X signal search",
    {
      provider: config.provider,
      monthly_budget_usd: config.monthly_budget_usd,
      rules: config.rules,
      runtime_state: config.runtime_state,
    },
  );

  console.log(JSON.stringify({
    ok: true,
    dry_run: false,
    source_id: source.id,
    adapter: SHARED_X_SOURCE_ADAPTER,
    projected_monthly_cost_usd: estimate,
    monthly_budget_usd: config.monthly_budget_usd,
    rule_count: config.rules.length,
  }, null, 2));
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
