#!/usr/bin/env node
/**
 * Production canary for the Exa intelligence layer. It starts the durable Exa
 * research workflow variants and verifies that each completes with graph
 * evidence plus cache/usage ledger state.
 *
 * Usage:
 *   npm run verify:exa -- --dry-run
 *   npm run verify:exa -- --workspace-id=<uuid> --user-id=<uuid>
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import {
  resetProductEngineForTests,
  startWorkspaceExaResearchWorkflow,
  type ProductExaResearchInput,
  type ProductExaResearchResult,
} from "../core/product/app.ts";
import {
  createExaAeoAuditWorkflow,
  createExaContentOpportunityWorkflow,
  createExaDraftGroundingWorkflow,
} from "../core/exa/workflows.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";
import { getPool } from "../core/substrate/storage/index.ts";

type CanaryIntent = NonNullable<ProductExaResearchInput["intent"]>;

interface CanaryCase {
  intent: CanaryIntent;
  label: string;
  query: string;
}

interface Args {
  dryRun: boolean;
  workspace_id?: string;
  user_id?: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

interface WorkspaceSessionRow {
  workspace_id: string;
  user_id: string;
}

const TERMINAL_STATUSES = new Set<WorkflowRun["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

const CANARY_CASES: CanaryCase[] = [
  {
    intent: "draft_grounding",
    label: "draft.grounding.exa",
    query: "AI native GTM platform outbound automation public evidence for sales teams",
  },
  {
    intent: "content_research",
    label: "content.opportunity.exa",
    query: "AI go to market automation buyer questions competitor narratives content gaps",
  },
  {
    intent: "aeo_audit",
    label: "aeo.audit.exa",
    query: "AI outbound sales automation category answers competitors buyer evaluation",
  },
];

loadDotenvLocal();
process.env.BOMBSELL_SUBSTRATE = "nats_restate";
process.env.RESTATE_BEARER_TOKEN ||= process.env.RESTATE_AUTH_TOKEN;

export async function runExaIntelligenceCanary(
  opts: Args,
): Promise<{
  ok: boolean;
  dry_run: boolean;
  workspace_id: string;
  user_id: string;
  results: Array<Record<string, unknown>>;
}> {
  requireEnv("DATABASE_URL");
  requireEnv("EXA_API_KEY");
  requireEnv("RESTATE_INGRESS_URL");

  const pool = getPool();
  const session = await resolveWorkspaceSession(pool, opts);
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: process.env.RESTATE_INGRESS_URL!,
    bearer: restateBearerFromEnv(),
  });
  registerCanaryWorkflows(runtime);

  if (opts.dryRun) {
    return {
      ok: true,
      dry_run: true,
      workspace_id: session.workspace_id,
      user_id: session.user_id,
      results: CANARY_CASES.map((entry) => ({
        workflow: entry.label,
        intent: entry.intent,
        query: entry.query,
        action: "dry_run",
      })),
    };
  }

  const results: Array<Record<string, unknown>> = [];
  const canaryStartedAt = new Date();
  const canaryNonce = `verify-exa:${new Date().toISOString()}`;

  for (const entry of CANARY_CASES) {
    const started = await startWorkspaceExaResearchWorkflow(
      {
        query: entry.query,
        intent: entry.intent,
        num_results: 3,
        include_text: true,
        idempotency_nonce: `${canaryNonce}:${entry.intent}`,
      },
      session,
    );
    const completed = await waitForWorkflow<ProductExaResearchResult>(
      runtime,
      started.workflow_run_id,
      opts,
    );
    const output = completed.output;
    const evidenceIds = output?.evidence_source_ids ?? [];
    const ledger = await readLedgerState(pool, session.workspace_id, entry.intent, canaryStartedAt);
    const eventState = await readEventState(pool, session.workspace_id, entry);
    const ok =
      completed.status === "completed" &&
      evidenceIds.length > 0 &&
      Boolean(output?.summary?.trim()) &&
      ledger.usage_count > 0 &&
      ledger.content_cache_count > 0 &&
      eventState.completed_count > 0 &&
      eventState.projected_count > 0;

    results.push({
      workflow: entry.label,
      intent: entry.intent,
      ok,
      run_id: started.workflow_run_id,
      status: completed.status,
      request_id: output?.request_id ?? null,
      evidence_source_count: evidenceIds.length,
      usage_count: ledger.usage_count,
      cache_hit_count: ledger.cache_hit_count,
      query_cache_count: ledger.query_cache_count,
      content_cache_count: ledger.content_cache_count,
      completed_event_count: eventState.completed_count,
      projected_event_count: eventState.projected_count,
      detail: ok
        ? "completed with evidence, events, and Exa ledger/cache state"
        : completed.error?.message ?? "missing one or more Exa completion proofs",
    });
  }

  return {
    ok: results.every((result) => result.ok === true),
    dry_run: false,
    workspace_id: session.workspace_id,
    user_id: session.user_id,
    results,
  };
}

async function waitForWorkflow<O>(
  runtime: WorkflowRuntime,
  run_id: string,
  opts: Pick<Args, "timeoutMs" | "pollIntervalMs">,
): Promise<WorkflowRun<unknown, O>> {
  const startedAt = Date.now();
  let latest = await runtime.get<unknown, O>(run_id);
  while (!latest || !TERMINAL_STATUSES.has(latest.status)) {
    if (Date.now() - startedAt >= opts.timeoutMs) {
      return {
        id: run_id,
        execution_scope: "workspace",
        workspace_id: "",
        workflow_name: "",
        workflow_version: "",
        status: latest?.status ?? "running",
        input: undefined,
        error: { message: `timed out after ${opts.timeoutMs}ms` },
        created_at: new Date().toISOString(),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalMs));
    latest = await runtime.get<unknown, O>(run_id);
  }
  return latest;
}

async function resolveWorkspaceSession(
  pool: Pool,
  opts: Pick<Args, "workspace_id" | "user_id">,
): Promise<WorkspaceSessionRow> {
  if (opts.workspace_id && opts.user_id) {
    return { workspace_id: opts.workspace_id, user_id: opts.user_id };
  }
  const { rows } = await pool.query<WorkspaceSessionRow>(
    `select wm.workspace_id, wm.user_id
       from workspace_members wm
       join workspaces w
         on w.id = wm.workspace_id
      where wm.accepted_at is not null
        and w.archived_at is null
        and ($1::uuid is null or wm.workspace_id = $1::uuid)
        and ($2::uuid is null or wm.user_id = $2::uuid)
      order by
        case wm.role::text when 'owner' then 0 when 'admin' then 1 else 2 end,
        wm.accepted_at asc nulls last,
        wm.workspace_id asc
      limit 1`,
    [opts.workspace_id ?? null, opts.user_id ?? null],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("No accepted workspace member found for Exa canary.");
  }
  return row;
}

async function readLedgerState(
  pool: Pool,
  workspace_id: string,
  intent: CanaryIntent,
  since: Date,
): Promise<{
  usage_count: number;
  cache_hit_count: number;
  query_cache_count: number;
  content_cache_count: number;
}> {
  const { rows } = await pool.query<{
    usage_count: string;
    cache_hit_count: string;
    query_cache_count: string;
    content_cache_count: string;
  }>(
    `select
        (select count(*)::text
           from workspace_exa_usage
          where workspace_id = $1
            and intent = $2
            and created_at >= $3) as usage_count,
        (select count(*)::text
           from workspace_exa_usage
          where workspace_id = $1
            and intent = $2
            and operation = 'search_cache_hit'
            and created_at >= $3) as cache_hit_count,
        (select count(*)::text
           from workspace_exa_query_cache
          where workspace_id = $1
            and intent = $2
            and expires_at > now()) as query_cache_count,
        (select count(*)::text
           from workspace_exa_content_cache
          where workspace_id = $1
            and expires_at > now()) as content_cache_count`,
    [workspace_id, intent, since],
  );
  const row = rows[0]!;
  return {
    usage_count: Number(row.usage_count),
    cache_hit_count: Number(row.cache_hit_count),
    query_cache_count: Number(row.query_cache_count),
    content_cache_count: Number(row.content_cache_count),
  };
}

async function readEventState(
  pool: Pool,
  workspace_id: string,
  entry: CanaryCase,
): Promise<{ completed_count: number; projected_count: number }> {
  const { rows } = await pool.query<{
    completed_count: string;
    projected_count: string;
  }>(
    `select
        count(*) filter (
          where event_type in ('rep.research.completed', 'content.opportunity.discovered', 'aeo.audit.completed')
        )::text as completed_count,
        count(*) filter (where event_type = 'exa.evidence.projected')::text as projected_count
       from events
      where workspace_id = $1
        and payload->>'query' = $2
        and (
          payload->>'intent' = $3
          or event_type in ('rep.research.completed', 'content.opportunity.discovered', 'aeo.audit.completed')
        )`,
    [workspace_id, entry.query, entry.intent],
  );
  const row = rows[0]!;
  return {
    completed_count: Number(row.completed_count),
    projected_count: Number(row.projected_count),
  };
}

function registerCanaryWorkflows(runtime: WorkflowRuntime): void {
  runtime.register(createExaDraftGroundingWorkflow());
  runtime.register(createExaContentOpportunityWorkflow());
  runtime.register(createExaAeoAuditWorkflow());
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    dryRun: false,
    timeoutMs: 90_000,
    pollIntervalMs: 1_000,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--workspace-id=")) args.workspace_id = uuidArg(arg, "--workspace-id=");
    else if (arg.startsWith("--user-id=")) args.user_id = uuidArg(arg, "--user-id=");
    else if (arg.startsWith("--timeout-ms=")) args.timeoutMs = positiveIntArg(arg, "--timeout-ms=");
    else if (arg.startsWith("--poll-ms=")) args.pollIntervalMs = positiveIntArg(arg, "--poll-ms=");
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function uuidArg(arg: string, prefix: string): string {
  const value = arg.slice(prefix.length).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${prefix.slice(0, -1)} must be a UUID`);
  }
  return value;
}

function positiveIntArg(arg: string, prefix: string): number {
  const value = Number(arg.slice(prefix.length));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${prefix.slice(0, -1)} must be a positive integer`);
  }
  return value;
}

function requireEnv(name: string): void {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}

function loadDotenvLocal(): void {
  if (!fs.existsSync(".env.local")) return;
  const text = fs.readFileSync(".env.local", "utf8");
  let currentKey: string | null = null;
  let quote: string | null = null;
  let buffer = "";
  for (const raw of text.split(/\n/)) {
    if (currentKey && quote) {
      buffer += `\n${raw}`;
      if (raw.endsWith(quote)) {
        process.env[currentKey] ||= buffer.slice(1, -1);
        currentKey = null;
        quote = null;
        buffer = "";
      }
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && !value.endsWith('"')) ||
      (value.startsWith("'") && !value.endsWith("'"))
    ) {
      currentKey = key;
      quote = value[0];
      buffer = value;
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const result = await runExaIntelligenceCanary(parseArgs(process.argv.slice(2)));
  console.log("Exa intelligence canary");
  for (const row of result.results) {
    console.log(
      `  ${row.ok === false ? "FAIL" : "OK  "} ${row.workflow} — ${row.detail ?? row.action}`,
    );
    if (row.run_id) console.log(`       run_id: ${row.run_id}`);
    if (row.evidence_source_count !== undefined) {
      console.log(
        `       evidence=${row.evidence_source_count} usage=${row.usage_count} cache_hits=${row.cache_hit_count}`,
      );
    }
  }
  console.log(JSON.stringify(result, null, 2));
  await resetProductEngineForTests();
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(async (err) => {
    console.error(`FAIL verify:exa — ${err instanceof Error ? err.message : String(err)}`);
    await resetProductEngineForTests();
    process.exit(1);
  });
}
