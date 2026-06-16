import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runSignalIngestionGraphInWorkflowStep,
  type BombsellLangGraphState,
  type SignalIngestionDecision,
  type SignalIngestionGraphInput,
} from "../core/agents/langgraph/index.ts";
import {
  _resetToolRegistry,
  registerTool,
} from "../core/agents/tools/registry.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";

async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 2000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await predicate();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

test("signal ingestion graph starts due source polls without matching or sending", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.sources.poll.start",
    description: "Start due workspace source poll workflows.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      dispatched: z.number().int().nonnegative(),
    }),
    async handler(input, ctx) {
      toolCalls.push("product.sources.poll.start");
      assert.equal(input.limit, 4);
      return { workspace_id: ctx.workspace_id, dispatched: 3 };
    },
  });

  runtime.register(
    defineWorkflow<SignalIngestionGraphInput, BombsellLangGraphState>({
      name: "signal_ingestion_graph_test",
      version: "1",
      async run(input, ctx) {
        return runSignalIngestionGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "signal_ingestion_graph_test",
    input: {
      workspace_id,
      user_id,
      limit: 4,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<SignalIngestionGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");

  const decision = output.attributes?.signal_ingestion as SignalIngestionDecision;
  assert.equal(decision.workspace_id, workspace_id);
  assert.equal(decision.dispatched, 3);
  assert.equal(decision.next_action, "await_signal_ingestion");
  assert.deepEqual(toolCalls, ["product.sources.poll.start"]);

  assert.equal(
    bus.published.some((event) =>
      [
        "signal.matched",
        "contact.resolved",
        "contact.resolution.deferred",
        "message.queued",
        "message.sent",
        "message.deferred",
      ].includes(event.event_type)
    ),
    false,
    "signal ingestion graph must not match leads, resolve contacts, or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
});
