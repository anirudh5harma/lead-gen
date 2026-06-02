import { test } from "node:test";
import assert from "node:assert/strict";
import { createRestateWorkflowRuntime } from "../core/substrate/workflows/index.ts";

test("Restate runtime get reads invocation output endpoint", async () => {
  const calls: string[] = [];
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: "https://restate.example.com",
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ checkpoint: "ok" }), { status: 200 });
    },
  });

  const run = await runtime.get<null, { checkpoint: string }>("inv_1");

  assert.equal(
    calls[0],
    "https://restate.example.com/restate/invocation/inv_1/output",
  );
  assert.equal(run?.status, "completed");
  assert.deepEqual(run?.output, { checkpoint: "ok" });
});

test("Restate runtime get maps not-ready output to running", async () => {
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: "https://restate.example.com",
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: "not ready" }), { status: 200 }),
  });

  const run = await runtime.get("inv_running");

  assert.equal(run?.status, "running");
  assert.equal(run?.output, undefined);
});

test("Restate runtime get maps 470 incomplete output to running", async () => {
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: "https://restate.example.com",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ message: "the invocation exists but has not completed yet" }),
        { status: 470 },
      ),
  });

  const run = await runtime.get("inv_running");

  assert.equal(run?.status, "running");
  assert.equal(run?.output, undefined);
});

test("Restate runtime get maps missing output to null", async () => {
  const runtime = createRestateWorkflowRuntime({
    ingressUrl: "https://restate.example.com",
    fetchImpl: async () =>
      new Response(JSON.stringify({ message: "not found" }), { status: 200 }),
  });

  assert.equal(await runtime.get("inv_missing"), null);
});
