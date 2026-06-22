#!/usr/bin/env node
/**
 * Configure the Exa social-post signal pack for existing workspace company
 * profiles. This keeps social monitoring explicit and Exa-backed, while
 * avoiding official X / LinkedIn APIs.
 *
 * Usage:
 *   npm run backfill:exa-social-signal-sources -- --dry-run
 *   npm run backfill:exa-social-signal-sources -- --limit=10
 *   npm run backfill:exa-social-signal-sources -- --workspace=<workspace_id>
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  configureExaSocialSignalPack,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { getPool } from "../core/substrate/storage/index.ts";

interface CandidateRow {
  workspace_id: string;
  user_id: string;
  workspace_name: string;
  company_name: string;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  signal_keywords: string | null;
  competitor_watchlist: string | null;
  linkedin_signal_behaviors: string | null;
}

loadDotenvLocal();

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  if (!process.env.EXA_API_KEY?.trim()) throw new Error("EXA_API_KEY is required");

  const candidates = await listCandidates(args);
  const results: Array<{
    workspace_id: string;
    workspace_name: string;
    company_name: string;
    action: "dry_run" | "configured" | "failed";
    source_count?: number;
    source_names?: string[];
    error?: string;
  }> = [];

  for (const row of candidates) {
    if (args.dryRun) {
      results.push({
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        company_name: row.company_name,
        action: "dry_run",
      });
      continue;
    }

    try {
      const result = await configureExaSocialSignalPack(
        {
          company_name: row.company_name,
          industry: row.industry ?? undefined,
          description: row.description ?? undefined,
          signal_keywords: row.signal_keywords ?? undefined,
          competitor_watchlist: row.competitor_watchlist ?? undefined,
          linkedin_signal_behaviors: row.linkedin_signal_behaviors ?? undefined,
          platforms: ["x", "linkedin"],
          freshness_days: 7,
          limit: 15,
          max_daily_items: 25,
          max_daily_calls: 6,
          monthly_spend_cap_usd: 3,
          enabled: true,
        },
        { workspace_id: row.workspace_id, user_id: row.user_id },
      );
      results.push({
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        company_name: row.company_name,
        action: "configured",
        source_count: result.source_count,
        source_names: result.sources.map((source) => source.name),
      });
    } catch (error) {
      results.push({
        workspace_id: row.workspace_id,
        workspace_name: row.workspace_name,
        company_name: row.company_name,
        action: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = results.filter((result) => result.action === "failed").length;
  console.log(JSON.stringify({
    ok: failed === 0,
    dry_run: args.dryRun,
    limit: args.limit,
    workspace_id: args.workspaceId,
    candidate_count: candidates.length,
    configured: results.filter((result) => result.action === "configured").length,
    failed,
    results,
  }, null, 2));

  await resetProductEngineForTests();
  process.exit(failed > 0 ? 1 : 0);
}

async function listCandidates(args: {
  limit: number;
  workspaceId: string | null;
}): Promise<CandidateRow[]> {
  const pool = getPool();
  const result = await pool.query<CandidateRow>(
    `select distinct on (gc.workspace_id)
        gc.workspace_id,
        wm.user_id,
        w.name as workspace_name,
        gc.name as company_name,
        gc.properties->>'website_url' as website_url,
        gc.industry,
        gc.description,
        gc.properties->>'signal_keywords' as signal_keywords,
        gc.properties->>'competitor_watchlist' as competitor_watchlist,
        gc.properties->>'linkedin_signal_behaviors' as linkedin_signal_behaviors
       from graph_companies gc
       join workspaces w
         on w.id = gc.workspace_id
       join workspace_members wm
         on wm.workspace_id = gc.workspace_id
        and wm.accepted_at is not null
      where gc.properties->>'profile_role' = 'workspace_company'
        and w.archived_at is null
        and ($2::uuid is null or gc.workspace_id = $2::uuid)
      order by
        gc.workspace_id,
        case wm.role::text when 'owner' then 0 when 'admin' then 1 else 2 end,
        wm.accepted_at asc
      limit $1`,
    [args.limit, args.workspaceId],
  );
  return result.rows;
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  limit: number;
  workspaceId: string | null;
} {
  let dryRun = false;
  let limit = 25;
  let workspaceId: string | null = null;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--limit must be a positive integer");
      }
      limit = value;
    } else if (arg.startsWith("--workspace=")) {
      workspaceId = arg.slice("--workspace=".length).trim() || null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun, limit, workspaceId };
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
