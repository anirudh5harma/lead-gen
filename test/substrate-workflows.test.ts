import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/adapters/in-process.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";

async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 2000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const v = await predicate();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, interval));
  }
}

test("workflow runtime: step result is journaled and replayed", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });

  let invocations = 0;
  const wf = defineWorkflow<{ ws: string }, number>({
    name: "step_journal",
    version: "1",
    async run(input, ctx) {
      const a = await ctx.step("compute", async () => {
        invocations++;
        return 41;
      });
      return a + 1;
    },
  });
  runtime.register(wf);

  const run = await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "step_journal",
    input: { ws: "w" },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const finalRun = await runtime.get(run.id);

  assert.equal(finalRun?.status, "completed");
  assert.equal(finalRun?.output, 42);
  assert.equal(invocations, 1);
});

test("workflow runtime: step retries on failure with backoff", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });

  let attempts = 0;
  const wf = defineWorkflow<unknown, string>({
    name: "retry_demo",
    version: "1",
    async run(_input, ctx) {
      return ctx.step(
        "flaky",
        async () => {
          attempts++;
          if (attempts < 3) throw new Error("flake");
          return "ok";
        },
        { retry: { max_attempts: 5, backoff: "fixed", base_ms: 1 } },
      );
    },
  });
  runtime.register(wf);

  const run = await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "retry_demo",
    input: null,
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const r = await runtime.get(run.id);
  assert.equal(r?.status, "completed");
  assert.equal(r?.output, "ok");
  assert.equal(attempts, 3);
});

test("workflow runtime: awaitEvent parks the workflow until a matching event lands", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });

  const wf = defineWorkflow<{ target: string }, string>({
    name: "wait_demo",
    version: "1",
    async run(input, ctx) {
      const payload = await ctx.awaitEvent<{ message_id: string; channel: string }>(
        "message.sent",
        (p) => p.message_id === input.target,
      );
      return payload.channel;
    },
  });
  runtime.register(wf);

  const target = randomUUID();
  const ws = randomUUID();
  const run = await runtime.start({
    workspace_id: ws,
    workflow_name: "wait_demo",
    input: { target },
  });

  await until(async () => (await runtime.get(run.id))?.status === "awaiting_event");

  // Off-target event: must not wake.
  await bus.publish({
    workspace_id: ws,
    event_type: "message.sent",
    source: "system",
    payload: {
      message_id: randomUUID(),
      channel: "linkedin_dm",
      external_id: null,
    },
  });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await runtime.get(run.id))?.status, "awaiting_event");

  // On-target event: wakes and completes.
  await bus.publish({
    workspace_id: ws,
    event_type: "message.sent",
    source: "system",
    payload: { message_id: target, channel: "email", external_id: "x-1" },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  assert.equal((await runtime.get(run.id))?.output, "email");
});

test("workflow runtime: requestApproval parks until resolveApproval is called", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });

  let captured: string | null = null;
  await bus.subscribe("approval.requested", (e) => {
    captured = e.payload.approval_id;
  });

  const wf = defineWorkflow<unknown, string>({
    name: "approval_demo",
    version: "1",
    async run(_input, ctx) {
      const decision = await ctx.requestApproval({
        kind: "outbound.email.send",
        payload: { recipient: "anon@example.com" },
      });
      return decision.decision;
    },
  });
  runtime.register(wf);

  const run = await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "approval_demo",
    input: null,
  });

  await until(async () => (await runtime.get(run.id))?.status === "awaiting_approval");
  await until(() => captured);

  await runtime.resolveApproval(captured!, {
    decision: "approved",
    decided_by: randomUUID(),
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  assert.equal((await runtime.get(run.id))?.output, "approved");
});

test("workflow runtime: ctx.publish emits with workflow correlation", async () => {
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });

  const correlations: (string | null)[] = [];
  await bus.subscribe("signal.dismissed", (e) => {
    correlations.push(e.correlation_id);
  });

  const wf = defineWorkflow<unknown, void>({
    name: "publish_demo",
    version: "1",
    async run(_input, ctx) {
      await ctx.publish("signal.dismissed", {
        signal_id: randomUUID(),
        reason: "not-icp",
      });
    },
  });
  runtime.register(wf);

  const run = await runtime.start({
    workspace_id: randomUUID(),
    workflow_name: "publish_demo",
    input: null,
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  await new Promise((r) => setImmediate(r));
  assert.equal(correlations.length, 1);
  assert.equal(correlations[0], run.id);
});
