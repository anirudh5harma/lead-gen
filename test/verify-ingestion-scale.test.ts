import { test } from "node:test";
import assert from "node:assert/strict";
import { runIngestionScaleProbe } from "../scripts/verify-ingestion-scale.ts";
import {
  type StartOptions,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";
import type {
  WorkspacePollSummary,
  WorkspacePollWorkflowInput,
} from "../core/ingest/index.ts";
import { WORKSPACE_POLL_WORKFLOW } from "../core/ingest/index.ts";

interface TargetRow {
  workspace_id: string;
  source_id: string;
  source_name: string;
  source_kind: string;
  poll_cadence_sec: number;
  last_polled_at: string | null;
}

class FakePool {
  sql = "";
  params: unknown[] = [];
  private readonly rows: TargetRow[];

  constructor(rows: TargetRow[]) {
    this.rows = rows;
  }

  async query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    this.sql = sql;
    this.params = params ?? [];
    return { rows: this.rows as T[] };
  }
}

function fakeRun(
  partial: Partial<WorkflowRun<WorkspacePollWorkflowInput, WorkspacePollSummary>>,
): WorkflowRun<WorkspacePollWorkflowInput, WorkspacePollSummary> {
  return {
    id: partial.id ?? "poll-run-1",
    execution_scope: partial.execution_scope ?? "workspace",
    workspace_id: partial.workspace_id ?? "workspace-1",
    workflow_name: partial.workflow_name ?? WORKSPACE_POLL_WORKFLOW,
    workflow_version: partial.workflow_version ?? "1",
    status: partial.status ?? "completed",
    input: partial.input ?? { workspace_id: "workspace-1", source_id: "source-1" },
    output: partial.output,
    error: partial.error,
    created_at: partial.created_at ?? new Date(0).toISOString(),
  };
}

function fakeRuntime(
  terminalRuns: WorkflowRun<WorkspacePollWorkflowInput, WorkspacePollSummary>[],
): WorkflowRuntime & { starts: StartOptions[] } {
  const starts: StartOptions[] = [];
  let startCount = 0;

  return {
    starts,
    register<I, O>(_workflow: WorkflowDefinition<I, O>) {},
    async start<I>(opts: StartOptions<I>) {
      starts.push(opts as StartOptions);
      const run = terminalRuns[startCount] ?? terminalRuns.at(-1);
      startCount += 1;
      if (!run) throw new Error("missing fake run");
      return run as WorkflowRun<I, unknown>;
    },
    async get<I, O>(run_id: string) {
      const run = terminalRuns.find((item) => item.id === run_id) ?? null;
      return run as WorkflowRun<I, O> | null;
    },
    async resume() {
      return null;
    },
    async resolveApproval() {},
  };
}

test("ingestion scale probe starts due workspace poll workflows and summarizes output", async () => {
  const pool = new FakePool([
    {
      workspace_id: "workspace-1",
      source_id: "source-1",
      source_name: "HN front",
      source_kind: "hn_front",
      poll_cadence_sec: 900,
      last_polled_at: null,
    },
    {
      workspace_id: "workspace-2",
      source_id: "source-2",
      source_name: "Reddit",
      source_kind: "reddit",
      poll_cadence_sec: 3600,
      last_polled_at: "2026-06-02T00:00:00.000Z",
    },
  ]);
  const runtime = fakeRuntime([
    fakeRun({
      id: "run-1",
      workspace_id: "workspace-1",
      input: { workspace_id: "workspace-1", source_id: "source-1" },
      output: {
        workspace_id: "workspace-1",
        source_id: "source-1",
        inserted: 2,
        duplicates: 1,
        skipped_must_haves: 0,
        skipped_budget: 0,
      },
    }),
    fakeRun({
      id: "run-2",
      workspace_id: "workspace-2",
      input: { workspace_id: "workspace-2", source_id: "source-2" },
      output: {
        workspace_id: "workspace-2",
        source_id: "source-2",
        inserted: 0,
        duplicates: 3,
        skipped_must_haves: 1,
        skipped_budget: 1,
      },
    }),
  ]);

  const result = await runIngestionScaleProbe({
    pool,
    runtime,
    marker: "scale-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 2);
  assert.equal(result.completed, 2);
  assert.equal(result.inserted, 2);
  assert.equal(result.duplicates, 4);
  assert.equal(result.skipped_must_haves, 1);
  assert.equal(result.skipped_budget, 1);
  assert.deepEqual(runtime.starts.map((item) => item.idempotency_key), [
    "scale-test:workspace-1:source-1",
    "scale-test:workspace-2:source-2",
  ]);
  assert.deepEqual(runtime.starts.map((item) => item.correlation_id), [
    "scale-test",
    "scale-test",
  ]);
  assert.equal(pool.params[0], 16);
  assert.match(pool.sql, /wsc\.last_polled_at is null/);
});

test("ingestion scale probe reports failed workspace workflows", async () => {
  const result = await runIngestionScaleProbe({
    pool: new FakePool([
      {
        workspace_id: "workspace-1",
        source_id: "source-1",
        source_name: "HN front",
        source_kind: "hn_front",
        poll_cadence_sec: 900,
        last_polled_at: null,
      },
    ]),
    runtime: fakeRuntime([
      fakeRun({
        status: "failed",
        error: { message: "Connection closed" },
      }),
    ]),
    marker: "scale-test",
  });

  assert.equal(result.ok, false);
  assert.equal(result.completed, 0);
  assert.equal(result.results[0]?.detail, "Connection closed");
});

test("ingestion scale probe can include not-due sources for controlled load tests", async () => {
  const pool = new FakePool([]);
  const result = await runIngestionScaleProbe({
    pool,
    runtime: fakeRuntime([]),
    includeNotDue: true,
    limit: 200,
    marker: "scale-test",
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 0);
  assert.equal(pool.params[0], 50);
  assert.doesNotMatch(pool.sql, /last_polled_at <= now/);
});
