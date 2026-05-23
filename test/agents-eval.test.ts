import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import {
  createHeuristicJudge,
  createNoopJudge,
  evalGate,
} from "../core/agents/eval/index.ts";

function fakeRep() {
  return {
    id: randomUUID(),
    name: "Maya",
    role: "sdr" as const,
    persona: { voice: "warm, direct, founder-to-founder" },
  };
}

test("eval gate: passing draft emits draft.judged with passed=true and no rejection", async () => {
  const bus = createInMemoryEventBus();
  const judge = createNoopJudge(0.9, 0.6);

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: fakeRep(),
      artifact: { kind: "draft", channel: "email", body: "Hi Anne, ..." },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "pass");
  await new Promise((r) => setImmediate(r));

  const types = bus.published.map((e) => e.event_type);
  assert.deepEqual(types, ["draft.judged"]);
  assert.equal(bus.published[0].payload.passed, true);
});

test("eval gate: failing draft emits draft.judged AND draft.rejected", async () => {
  const bus = createInMemoryEventBus();
  const judge = createNoopJudge(0.3, 0.6); // sub-threshold

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: fakeRep(),
      artifact: { kind: "draft", channel: "email", body: "no" },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "reject");
  await new Promise((r) => setImmediate(r));

  const types = bus.published.map((e) => e.event_type);
  assert.deepEqual(types, ["draft.judged", "draft.rejected"]);
});

test("heuristic judge: catches banned phrases", async () => {
  const bus = createInMemoryEventBus();
  const judge = createHeuristicJudge({
    banned_phrases: ["lorem ipsum"],
    threshold: 0.9,
  });

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: fakeRep(),
      artifact: {
        kind: "draft",
        channel: "email",
        body:
          "Hi Anne, lorem ipsum dolor sit amet, consectetur adipiscing elit, etc.",
      },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "reject");
  assert.ok(result.rejection_reason?.includes("banned"));
});
