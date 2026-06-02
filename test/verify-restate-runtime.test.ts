import { test } from "node:test";
import assert from "node:assert/strict";
import { runRestateRuntimeProbe } from "../scripts/verify-restate-runtime.ts";
import {
  RESTATE_RUNTIME_PROBE_WORKFLOW,
  type StartOptions,
  type WorkflowDefinition,
  type WorkflowRun,
  type WorkflowRuntime,
} from "../core/substrate/workflows/index.ts";

function fakeRuntime(
  statuses: Array<Partial<WorkflowRun<{ marker: string }, { marker: string; checkpoint: string }>>>,
): WorkflowRuntime & { registered: string[]; starts: StartOptions[] } {
  const registered: string[] = [];
  const starts: StartOptions[] = [];
  let getCount = 0;
  const first = statuses[0] ?? {};

  function runFrom(
    partial: Partial<WorkflowRun<{ marker: string }, { marker: string; checkpoint: string }>>,
  ): WorkflowRun<{ marker: string }, { marker: string; checkpoint: string }> {
    return {
      id: partial.id ?? "probe-run-1",
      execution_scope: partial.execution_scope ?? "platform",
      workspace_id: partial.workspace_id ?? null,
      workflow_name: partial.workflow_name ?? RESTATE_RUNTIME_PROBE_WORKFLOW,
      workflow_version: partial.workflow_version ?? "1",
      status: partial.status ?? "running",
      input: partial.input ?? { marker: "probe-test" },
      output: partial.output,
      error: partial.error,
      created_at: partial.created_at ?? new Date(0).toISOString(),
    };
  }

  return {
    registered,
    starts,
    register<I, O>(workflow: WorkflowDefinition<I, O>) {
      registered.push(workflow.name);
    },
    async start<I>(opts: StartOptions<I>) {
      starts.push(opts as StartOptions);
      return runFrom(first) as WorkflowRun<I, unknown>;
    },
    async get() {
      getCount += 1;
      return runFrom(statuses[getCount] ?? statuses.at(-1) ?? first);
    },
    async resume() {
      return null;
    },
    async resolveApproval() {},
  };
}

test("verify-restate-runtime passes when the probe checkpoint completes", async () => {
  const runtime = fakeRuntime([
    { status: "running" },
    {
      status: "completed",
      output: { marker: "probe-test", checkpoint: "ok" },
    },
  ]);

  const result = await runRestateRuntimeProbe({
    runtime,
    marker: "probe-test",
    sleep: async () => undefined,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.detail, "runtime completed a durable checkpoint");
  assert.deepEqual(runtime.registered, [RESTATE_RUNTIME_PROBE_WORKFLOW]);
  assert.deepEqual(runtime.starts[0], {
    workflow_name: RESTATE_RUNTIME_PROBE_WORKFLOW,
    execution_scope: "platform",
    workspace_id: null,
    idempotency_key: "runtime-probe:probe-test",
    input: { marker: "probe-test" },
  });
});

test("verify-restate-runtime fails when the probe workflow fails", async () => {
  const result = await runRestateRuntimeProbe({
    runtime: fakeRuntime([
      { status: "running" },
      { status: "failed", error: { message: "Connection closed" } },
    ]),
    marker: "probe-test",
    sleep: async () => undefined,
  });

  assert.deepEqual(result, {
    ok: false,
    run_id: "probe-run-1",
    status: "failed",
    detail: "Connection closed",
  });
});

test("verify-restate-runtime times out while the probe is still running", async () => {
  let clock = 0;
  const result = await runRestateRuntimeProbe({
    runtime: fakeRuntime([{ status: "running" }, { status: "running" }]),
    marker: "probe-test",
    timeoutMs: 10,
    pollIntervalMs: 5,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "running");
  assert.match(result.detail, /timed out after 10ms/);
});
