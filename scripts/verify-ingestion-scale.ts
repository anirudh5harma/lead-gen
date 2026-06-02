import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { getPool } from "../core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";
import {
  WORKSPACE_POLL_WORKFLOW,
  type WorkspacePollWorkflowInput,
  type WorkspacePollSummary,
} from "../core/ingest/index.ts";

interface Queryable {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

interface WorkspacePollTarget {
  workspace_id: string;
  source_id: string;
  source_name: string;
  source_kind: string;
  poll_cadence_sec: number;
  last_polled_at: string | null;
}

interface IngestionScaleOptions {
  pool?: Queryable;
  runtime?: WorkflowRuntime;
  limit?: number;
  includeNotDue?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  marker?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
}

export interface IngestionScaleWorkflowResult {
  target: WorkspacePollTarget;
  run_id: string;
  status: WorkflowRun["status"];
  ok: boolean;
  summary?: WorkspacePollSummary;
  detail: string;
}

export interface IngestionScaleResult {
  ok: boolean;
  marker: string;
  selected: number;
  completed: number;
  inserted: number;
  duplicates: number;
  skipped_must_haves: number;
  skipped_budget: number;
  results: IngestionScaleWorkflowResult[];
}

const TERMINAL_STATUSES = new Set<WorkflowRun["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export async function runIngestionScaleProbe(
  opts: IngestionScaleOptions = {},
): Promise<IngestionScaleResult> {
  const limit = boundedLimit(opts.limit ?? 16);
  const marker = opts.marker ?? `ingestion-scale-${randomUUID()}`;
  const pool = opts.pool ?? getPool();
  const runtime = opts.runtime ?? runtimeFromEnv(opts.env ?? process.env);
  const targets = await listWorkspacePollTargets(pool, {
    limit,
    includeNotDue: opts.includeNotDue ?? false,
  });
  const results: IngestionScaleWorkflowResult[] = [];

  for (const target of targets) {
    results.push(await runOneTarget(runtime, target, marker, opts));
  }

  return summarize(marker, results);
}

async function listWorkspacePollTargets(
  pool: Queryable,
  opts: { limit: number; includeNotDue: boolean },
): Promise<WorkspacePollTarget[]> {
  const duePredicate = opts.includeNotDue
    ? "true"
    : `(
         wsc.last_polled_at is null
         or wsc.last_polled_at <= now() - (wsc.poll_cadence_sec * interval '1 second')
       )`;
  const { rows } = await pool.query<WorkspacePollTarget>(
    `select
        wsc.workspace_id,
        wsc.source_id,
        gs.name as source_name,
        gs.kind as source_kind,
        wsc.poll_cadence_sec,
        wsc.last_polled_at::text as last_polled_at
       from workspace_source_configs wsc
       join workspaces w on w.id = wsc.workspace_id
       join graph_sources gs
         on gs.workspace_id = wsc.workspace_id and gs.id = wsc.source_id
      where w.archived_at is null
        and wsc.enabled
        and gs.enabled
        and ${duePredicate}
      order by
        wsc.last_polled_at nulls first,
        wsc.workspace_id,
        wsc.source_id
      limit $1`,
    [opts.limit],
  );
  return rows;
}

async function runOneTarget(
  runtime: WorkflowRuntime,
  target: WorkspacePollTarget,
  marker: string,
  opts: IngestionScaleOptions,
): Promise<IngestionScaleWorkflowResult> {
  try {
    const input: WorkspacePollWorkflowInput = {
      workspace_id: target.workspace_id,
      source_id: target.source_id,
    };
    const started = await runtime.start<WorkspacePollWorkflowInput, WorkspacePollSummary>({
      workflow_name: WORKSPACE_POLL_WORKFLOW,
      workspace_id: target.workspace_id,
      input,
      idempotency_key: `${marker}:${target.workspace_id}:${target.source_id}`,
      correlation_id: marker,
    });
    const latest = await waitForRun(runtime, started, opts);
    if (latest.status !== "completed") {
      return {
        target,
        run_id: latest.id,
        status: latest.status,
        ok: false,
        detail: latest.error?.message ?? `${WORKSPACE_POLL_WORKFLOW} did not complete`,
      };
    }
    return {
      target,
      run_id: latest.id,
      status: latest.status,
      ok: true,
      summary: latest.output,
      detail: formatSummary(latest.output),
    };
  } catch (err) {
    return {
      target,
      run_id: "start_failed",
      status: "failed",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function waitForRun(
  runtime: WorkflowRuntime,
  started: WorkflowRun<WorkspacePollWorkflowInput, WorkspacePollSummary>,
  opts: IngestionScaleOptions,
): Promise<WorkflowRun<WorkspacePollWorkflowInput, WorkspacePollSummary>> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 1_000;
  const startedAt = now();
  let latest = started;
  while (!TERMINAL_STATUSES.has(latest.status)) {
    if (now() - startedAt >= timeoutMs) {
      return {
        ...latest,
        status: "failed",
        error: {
          message: `timed out after ${timeoutMs}ms waiting for ${WORKSPACE_POLL_WORKFLOW}`,
        },
      };
    }
    await sleep(pollIntervalMs);
    latest = (await runtime.get<WorkspacePollWorkflowInput, WorkspacePollSummary>(started.id)) ?? latest;
  }
  return latest;
}

function summarize(
  marker: string,
  results: IngestionScaleWorkflowResult[],
): IngestionScaleResult {
  const totals = results.reduce(
    (acc, item) => {
      if (item.ok) acc.completed += 1;
      acc.inserted += item.summary?.inserted ?? 0;
      acc.duplicates += item.summary?.duplicates ?? 0;
      acc.skipped_must_haves += item.summary?.skipped_must_haves ?? 0;
      acc.skipped_budget += item.summary?.skipped_budget ?? 0;
      return acc;
    },
    {
      completed: 0,
      inserted: 0,
      duplicates: 0,
      skipped_must_haves: 0,
      skipped_budget: 0,
    },
  );
  return {
    ok: results.every((result) => result.ok),
    marker,
    selected: results.length,
    ...totals,
    results,
  };
}

function runtimeFromEnv(env: Record<string, string | undefined>): WorkflowRuntime {
  const ingressUrl = env.RESTATE_INGRESS_URL?.trim();
  if (!ingressUrl) throw new Error("RESTATE_INGRESS_URL is required");
  return createRestateWorkflowRuntime({
    ingressUrl,
    bearer: restateBearerFromEnv(env),
  });
}

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 16;
  return Math.max(1, Math.min(50, Math.trunc(limit)));
}

function formatSummary(summary: WorkspacePollSummary | undefined): string {
  if (!summary) return "completed without output payload";
  return [
    `inserted=${summary.inserted}`,
    `duplicates=${summary.duplicates}`,
    `skipped_must_haves=${summary.skipped_must_haves}`,
    `skipped_budget=${summary.skipped_budget}`,
  ].join(" ");
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  const includeNotDue = args.has("--include-not-due");
  console.log(
    `Ingestion scale probe: limit=${boundedLimit(limit ?? 16)} due_only=${String(!includeNotDue)}`,
  );
  const result = await runIngestionScaleProbe({ limit, includeNotDue });
  console.log(
    `Selected ${result.selected}; completed ${result.completed}; inserted ${result.inserted}; duplicates ${result.duplicates}; skipped_must_haves ${result.skipped_must_haves}; skipped_budget ${result.skipped_budget}`,
  );
  for (const item of result.results) {
    const label = item.ok ? "OK  " : "FAIL";
    console.log(
      `  ${label} ${item.target.source_name} (${item.target.source_kind}) ${item.run_id} - ${item.detail}`,
    );
  }
  if (!result.ok) {
    console.error("\nIngestion scale probe failed.");
    process.exit(1);
  }
  console.log("\nIngestion scale probe passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
