import { test } from "node:test";
import assert from "node:assert/strict";
import * as restate from "@restatedev/restate-sdk";
import { randomUUID } from "node:crypto";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";
import { createRestateRuntimeProbeWorkflow } from "../core/substrate/workflows/probe.ts";
import {
  createRestateWorkflowComponent,
  createRunContext,
  serveRestateWorkflows,
  type RestateWorkflowRequest,
} from "../core/substrate/workflows/adapters/restate-host.ts";
import type {
  RestateEventSignal,
  RestateEventSignalStore,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import type { EventBus } from "../core/substrate/events/index.ts";
import type { ApprovalDecision } from "../core/substrate/workflows/index.ts";

function fakeCtx(opts: {
  key?: string;
  invocationId?: string;
  approval?: ApprovalDecision;
	} = {}) {
  const runs: Array<{ name: string; options: unknown }> = [];
  const sleeps: Array<{ ms: number; name?: string }> = [];
  const promises = new Map<string, {
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
  }>();
  function durablePromise(name: string) {
    let durable = promises.get(name);
    if (!durable) {
      let resolve!: (value: unknown) => void;
      const promise = new Promise<unknown>((r) => {
        resolve = r;
      });
      durable = { promise, resolve };
      promises.set(name, durable);
    }
    return {
      get: () => durable.promise,
      resolve: async (value: unknown) => {
        durable.resolve(value);
      },
    };
  }
  return {
    runs,
    sleeps,
    promises,
    ctx: {
      key: opts.key ?? "workflow-key",
      request: () => ({
        id: opts.invocationId ?? "invocation-1",
        target: { key: opts.key ?? "workflow-key" },
      }),
      run: async (name: string, fn: () => Promise<unknown>, options?: unknown) => {
        runs.push({ name, options });
        return fn();
      },
      sleep: async (ms: number, name?: string) => {
        sleeps.push({ ms, name });
      },
      awakeable: () => ({
        id: "awakeable-1",
        promise: Promise.resolve(
          opts.approval ?? { decision: "approved", decided_by: "user-1" },
        ),
      }),
      promise: durablePromise,
    } as unknown as restate.WorkflowContext,
  };
}

function captureBus(): EventBus & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    events,
    async publish(input) {
      events.push(input);
      return {
        id: randomUUID(),
        schema_version: input.schema_version ?? 1,
        correlation_id: input.correlation_id ?? null,
        causation_id: input.causation_id ?? null,
        producer_ref: input.producer_ref ?? null,
        idempotency_key: input.idempotency_key ?? null,
        occurred_at: new Date().toISOString(),
        ...input,
      };
    },
    async subscribe() {
      return { unsubscribe: async () => undefined };
    },
  };
}

const request = {
  request: { value: 7 },
  metadata: {
    workspace_id: randomUUID(),
    correlation_id: "cor-1",
    causation_id: "cause-1",
  },
} satisfies RestateWorkflowRequest<{ value: number }>;

test("Restate HTTP/1 host keeps bidirectional protocol enabled", async () => {
  const sentinel = new Error("stop before binding test server");
  const definition = defineWorkflow<null, void>({
    name: "protocol_guard",
    version: "1",
    async run() {},
  });

  await assert.rejects(
    serveRestateWorkflows({
      workflows: [definition],
      http1: true,
      createEndpointHandler(options) {
        assert.equal(options.bidirectional, true);
        throw sentinel;
      },
    }),
    sentinel,
  );
});

test("Restate host bridge maps WorkflowDefinition.run to a native workflow run handler", async () => {
  const definition = defineWorkflow<{ value: number }, number>({
    name: "demo_workflow",
    version: "1",
    async run(input, ctx) {
      await ctx.sleep(25);
      return ctx.step(
        "double",
        async () => input.value * 2,
        { retry: { max_attempts: 4, backoff: "fixed", base_ms: 123 } },
      );
    },
  });
  const component = createRestateWorkflowComponent(definition);
  const fx = fakeCtx();

  const output = await (component as never as {
    workflow: {
      run: (
        ctx: restate.WorkflowContext,
        input: RestateWorkflowRequest<{ value: number }>,
      ) => Promise<number>;
    };
  }).workflow.run(fx.ctx, request);

  assert.equal(output, 14);
  assert.deepEqual(fx.sleeps, [{ ms: 25, name: "sleep" }]);
  assert.deepEqual(fx.runs, [
    {
      name: "double",
      options: {
        maxRetryAttempts: 4,
        initialRetryInterval: 123,
        retryIntervalFactor: 1,
      },
    },
  ]);
});

test("Restate RunContext publishes workflow events with correlation metadata", async () => {
  const bus = captureBus();
  const fx = fakeCtx({ invocationId: "inv-99" });
  const definition = defineWorkflow<null, void>({
    name: "publisher",
    version: "1",
    async run() {},
  });
  const ctx = createRunContext(fx.ctx, definition, {
    request: null,
    metadata: { workspace_id: request.metadata.workspace_id, correlation_id: "cor-2" },
  }, { bus });

  await ctx.publish("signal.dismissed", {
    signal_id: randomUUID(),
    reason: "test",
  });

  assert.equal(bus.events.length, 1);
  assert.equal((bus.events[0] as { producer_ref: string }).producer_ref, "workflow:publisher:inv-99");
  assert.equal((bus.events[0] as { correlation_id: string }).correlation_id, "cor-2");
  assert.equal(
    (bus.events[0] as { idempotency_key: string }).idempotency_key,
    "workflow:inv-99:event:0",
  );
  assert.equal(fx.runs[0].name, "publish:0:signal.dismissed");
});

test("Restate platform context checkpoints work but rejects unscoped event publication", async () => {
  const bus = captureBus();
  const fx = fakeCtx({ invocationId: "inv-platform" });
  const definition = defineWorkflow<null, void>({
    name: "platform_sweep",
    version: "1",
    async run() {},
  });
  const ctx = createRunContext(fx.ctx, definition, {
    request: null,
    metadata: { execution_scope: "platform", workspace_id: null },
  }, { bus });

  assert.equal(ctx.execution_scope, "platform");
  assert.equal(ctx.workspace_id, null);
  assert.equal(await ctx.step("scan", async () => 7), 7);
  await assert.rejects(
    ctx.publish("signal.dismissed", { signal_id: randomUUID(), reason: "bad-scope" }),
    (err: unknown) => err instanceof restate.TerminalError,
  );
  assert.equal(bus.events.length, 0);
});

test("Restate runtime probe completes one platform checkpoint", async () => {
  const component = createRestateWorkflowComponent(createRestateRuntimeProbeWorkflow());
  const fx = fakeCtx({ invocationId: "inv-probe" });

  const output = await (component as never as {
    workflow: {
      run: (
        ctx: restate.WorkflowContext,
        input: RestateWorkflowRequest<{ marker: string }>,
      ) => Promise<{ marker: string; checkpoint: string }>;
    };
  }).workflow.run(fx.ctx, {
    request: { marker: "probe-test" },
    metadata: { execution_scope: "platform", workspace_id: null },
  });

  assert.deepEqual(output, { marker: "probe-test", checkpoint: "ok" });
  assert.deepEqual(fx.runs, [{ name: "checkpoint", options: {} }]);
});

test("Restate runtime probe rejects workspace-scoped execution", async () => {
  const component = createRestateWorkflowComponent(createRestateRuntimeProbeWorkflow());
  const fx = fakeCtx({ invocationId: "inv-probe-bad-scope" });

  await assert.rejects(
    (component as never as {
      workflow: {
        run: (
          ctx: restate.WorkflowContext,
          input: RestateWorkflowRequest<{ marker: string }>,
        ) => Promise<{ marker: string; checkpoint: string }>;
      };
    }).workflow.run(fx.ctx, {
      request: { marker: "probe-test" },
      metadata: { workspace_id: request.metadata.workspace_id },
    }),
    /platform scope/,
  );
  assert.deepEqual(fx.runs, []);
});

test("Restate RunContext requests approval with an awakeable id", async () => {
  const bus = captureBus();
  const fx = fakeCtx({ invocationId: "inv-approval" });
  const definition = defineWorkflow<null, void>({
    name: "approval_flow",
    version: "1",
    async run() {},
  });
  const ctx = createRunContext(fx.ctx, definition, {
    request: null,
    metadata: { workspace_id: request.metadata.workspace_id, correlation_id: "cor-3" },
  }, { bus });

  const decision = await ctx.requestApproval({
    kind: "draft.send",
    payload: { message_id: "m-1" },
  });

  assert.equal(decision.decision, "approved");
  assert.equal(bus.events.length, 1);
  assert.equal((bus.events[0] as { event_type: string }).event_type, "approval.requested");
  assert.deepEqual((bus.events[0] as { payload: { approval_id: string; run_id: string; kind: string } }).payload, {
    approval_id: "awakeable-1",
    run_id: "inv-approval",
    step_id: null,
    kind: "draft.send",
  });
});

test("Restate RunContext awaits typed events through the signal bridge", async () => {
  const fx = fakeCtx();
  const waits: Parameters<RestateEventSignalStore["registerWait"]>[0][] = [];
  const consumed: string[] = [];
  const eventSignals: RestateEventSignalStore = {
    async registerWait(wait) {
      waits.push(wait);
      const signal: RestateEventSignal = {
        wait_id: wait.id,
        promise_name: wait.promise_name,
        event: {
          id: randomUUID(),
          workspace_id: wait.workspace_id,
          event_type: wait.event_type,
          schema_version: 1,
          correlation_id: null,
          causation_id: null,
          source: "system",
          producer_ref: null,
          idempotency_key: null,
          payload: { message_id: "m-1", channel: "email" },
          occurred_at: new Date().toISOString(),
        },
      };
      setTimeout(() => {
        fx.promises.get(wait.promise_name)?.resolve(signal);
      }, 0);
    },
    async consumeWait(waitId) {
      consumed.push(waitId);
    },
  };
  const definition = defineWorkflow<null, void>({
    name: "waiter",
    version: "1",
    async run() {},
  });
  const ctx = createRunContext(fx.ctx, definition, {
    request: null,
    metadata: { workspace_id: request.metadata.workspace_id },
  }, { eventSignals });

  const payload = await ctx.awaitEvent<{ message_id: string; channel: string }>(
    "signal.matched",
    (p) => p.channel === "email",
  );

  assert.deepEqual(payload, { message_id: "m-1", channel: "email" });
  assert.equal(waits.length, 1);
  assert.equal(waits[0].workflow_name, "waiter");
  assert.equal(waits[0].workflow_key, "workflow-key");
  assert.equal(waits[0].run_id, "invocation-1");
  assert.equal(waits[0].event_type, "signal.matched");
  assert.deepEqual(consumed, [waits[0].id]);
});

test("Restate RunContext fails closed when event waits lack a signal store", async () => {
  const fx = fakeCtx();
  const definition = defineWorkflow<null, void>({
    name: "waiter",
    version: "1",
    async run() {},
  });
  const ctx = createRunContext(fx.ctx, definition, {
    request: null,
    metadata: { workspace_id: request.metadata.workspace_id },
  });

  await assert.rejects(
    ctx.awaitEvent("signal.matched"),
    (err: unknown) => err instanceof restate.TerminalError,
  );
});

test("Restate workflow signal handler resolves the durable event promise", async () => {
  const definition = defineWorkflow<null, void>({
    name: "waiter",
    version: "1",
    async run() {},
  });
  const component = createRestateWorkflowComponent(definition);
  const fx = fakeCtx();
  const signal = {
    wait_id: "wait-1",
    promise_name: "event:signal.matched:0",
    event: {
      id: randomUUID(),
      workspace_id: request.metadata.workspace_id,
      event_type: "signal.matched",
      schema_version: 1,
      correlation_id: null,
      causation_id: null,
      source: "system",
      producer_ref: null,
      idempotency_key: null,
      payload: { signal_id: "s-1" },
      occurred_at: new Date().toISOString(),
    },
  } satisfies RestateEventSignal;

  const promise = fx.ctx.promise<RestateEventSignal>(signal.promise_name).get();
  await (component as never as {
    workflow: {
      resolveEventWait: (
        ctx: restate.WorkflowSharedContext,
        signal: RestateEventSignal,
      ) => Promise<void>;
    };
  }).workflow.resolveEventWait(fx.ctx as unknown as restate.WorkflowSharedContext, signal);

  assert.deepEqual(await promise, signal);
});
