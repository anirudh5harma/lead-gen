import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  invokeTool,
  listTools,
  observeToolInvocations,
  registerTool,
  _resetToolRegistry,
  type ToolInvocationTrace,
} from "../core/agents/tools/registry.ts";

beforeEach(() => _resetToolRegistry());

test("tool registry: registers, lists, invokes", async () => {
  registerTool({
    name: "demo.add",
    description: "adds two numbers",
    kind: "read",
    input: z.object({ a: z.number(), b: z.number() }),
    output: z.object({ sum: z.number() }),
    async handler({ a, b }) {
      return { sum: a + b };
    },
  });

  assert.deepEqual(
    listTools().map((t) => t.name),
    ["demo.add"],
  );

  const ws = randomUUID();
  const out = await invokeTool<{ sum: number }>(
    "demo.add",
    { a: 2, b: 3 },
    { workspace_id: ws },
  );
  assert.equal(out.sum, 5);
});

test("tool registry: rejects unknown tool", async () => {
  await assert.rejects(
    invokeTool("missing", {}, { workspace_id: randomUUID() }),
    /Unknown tool/,
  );
});

test("tool registry: validates input and output", async () => {
  registerTool({
    name: "demo.upper",
    description: "uppercases",
    kind: "read",
    input: z.object({ s: z.string() }),
    output: z.object({ s: z.string() }),
    async handler({ s }) {
      return { s: s.toUpperCase() };
    },
  });

  await assert.rejects(
    // @ts-expect-error — intentional bad input
    invokeTool("demo.upper", { s: 42 }, { workspace_id: randomUUID() }),
  );
});

test("tool registry: observer receives a trace per invocation, including on error", async () => {
  const traces: ToolInvocationTrace[] = [];
  observeToolInvocations((t) => {
    traces.push(t);
  });

  registerTool({
    name: "demo.ok",
    description: "",
    kind: "read",
    input: z.object({}),
    output: z.object({ k: z.literal("ok") }),
    async handler() {
      return { k: "ok" } as const;
    },
  });
  registerTool({
    name: "demo.fail",
    description: "",
    kind: "read",
    input: z.object({}),
    output: z.object({}),
    async handler() {
      throw new Error("boom");
    },
  });

  const ws = randomUUID();
  await invokeTool("demo.ok", {}, { workspace_id: ws });
  await assert.rejects(invokeTool("demo.fail", {}, { workspace_id: ws }));

  assert.equal(traces.length, 2);
  assert.equal(traces[0].tool, "demo.ok");
  assert.equal(traces[0].error, undefined);
  assert.equal(traces[1].tool, "demo.fail");
  assert.equal(traces[1].error?.message, "boom");
});
