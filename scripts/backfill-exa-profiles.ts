#!/usr/bin/env node
/**
 * Start durable Exa Profile bootstrap workflows for existing workspace company
 * profiles. The workflow owns Exa calls, typed events, and graph projection.
 *
 * Usage:
 *   npm run backfill:exa-profiles -- --dry-run
 *   npm run backfill:exa-profiles -- --limit=10
 *   npm run backfill:exa-profiles -- --force
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  resetProductEngineForTests,
  startWorkspaceProfileEnrichmentWithExa,
} from "../core/product/app.ts";
import { getPool } from "../core/substrate/storage/index.ts";

interface CandidateRow {
  workspace_id: string;
  user_id: string;
  company_id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  industry: string | null;
  description: string | null;
  enriched_at: string | null;
}

loadDotenvLocal();
process.env.BOMBSELL_SUBSTRATE = "nats_restate";
process.env.RESTATE_BEARER_TOKEN ||= process.env.RESTATE_AUTH_TOKEN;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required");
  if (!process.env.EXA_API_KEY?.trim()) throw new Error("EXA_API_KEY is required");
  if (!process.env.RESTATE_INGRESS_URL?.trim()) throw new Error("RESTATE_INGRESS_URL is required");

  const candidates = await listCandidates(args.limit, args.force);

  const results: Array<{
    workspace_id: string;
    company_id: string;
    company_name: string;
    action: "dry_run" | "started" | "failed";
    workflow_run_id?: string;
    error?: string;
  }> = [];

  for (const row of candidates) {
    if (args.dryRun) {
      results.push({
        workspace_id: row.workspace_id,
        company_id: row.company_id,
        company_name: row.company_name,
        action: "dry_run",
      });
      continue;
    }
    try {
      const run = await startWorkspaceProfileEnrichmentWithExa(
        {
          company_id: row.company_id,
          company_name: row.company_name,
          website_url: row.website_url ?? (row.domain ? `https://${row.domain}` : undefined),
          industry: row.industry ?? undefined,
          description: row.description ?? undefined,
        },
        { workspace_id: row.workspace_id, user_id: row.user_id },
      );
      results.push({
        workspace_id: row.workspace_id,
        company_id: row.company_id,
        company_name: row.company_name,
        action: "started",
        workflow_run_id: run.workflow_run_id,
      });
    } catch (error) {
      results.push({
        workspace_id: row.workspace_id,
        company_id: row.company_id,
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
    force: args.force,
    candidate_count: candidates.length,
    started: results.filter((result) => result.action === "started").length,
    failed,
    results,
  }, null, 2));

  await resetProductEngineForTests();
  process.exit(failed > 0 ? 1 : 0);
}

async function listCandidates(limit: number, force: boolean): Promise<CandidateRow[]> {
  const pool = getPool();
  const result = await pool.query<CandidateRow>(
    `select distinct on (gc.workspace_id, gc.id)
        gc.workspace_id,
        wm.user_id,
        gc.id as company_id,
        gc.name as company_name,
        gc.domain,
        gc.properties->>'website_url' as website_url,
        gc.industry,
        gc.description,
        gc.properties #>> '{exa_profile,enriched_at}' as enriched_at
       from graph_companies gc
       join workspace_members wm
         on wm.workspace_id = gc.workspace_id
        and wm.accepted_at is not null
      where gc.properties->>'profile_role' = 'workspace_company'
        and ($2::boolean or gc.properties #>> '{exa_profile,enriched_at}' is null)
      order by
        gc.workspace_id,
        gc.id,
        case wm.role::text when 'owner' then 0 when 'admin' then 1 else 2 end,
        wm.accepted_at asc
      limit $1`,
    [limit, force],
  );
  return result.rows;
}

function parseArgs(argv: string[]): { dryRun: boolean; force: boolean; limit: number } {
  let dryRun = false;
  let force = false;
  let limit = 25;
  for (const arg of argv) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value < 1) throw new Error("--limit must be a positive integer");
      limit = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { dryRun, force, limit };
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
