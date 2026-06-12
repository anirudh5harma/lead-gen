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
    persona: { voice: "warm, direct, founder-to-founder", do_not: [], samples: [] },
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

test("eval gate: brand voice guardrail rejects do-not violations", async () => {
  const bus = createInMemoryEventBus();
  const judge = createNoopJudge(0.95, 0.6);

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: {
        ...fakeRep(),
        persona: {
          voice: "warm, precise, low-hype",
          do_not: ["Do not mention being an AI."],
          samples: [],
        },
      },
      artifact: {
        kind: "draft",
        channel: "email",
        body: "Hi Anne, I am an AI language model reaching out about your launch.",
      },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "reject");
  assert.ok(result.rejection_reason?.includes("do-not"));
  assert.equal(result.verdict.notes.axes.brand_voice, 0);
});

test("eval gate: AI do-not allows target-company AI context", async () => {
  const bus = createInMemoryEventBus();
  const judge = createNoopJudge(0.95, 0.6);

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: {
        ...fakeRep(),
        persona: {
          voice: "warm, precise, low-hype",
          do_not: ["Do not mention being an AI."],
          samples: [],
        },
      },
      artifact: {
        kind: "draft",
        channel: "email",
        body:
          "Hi Anne, your new AI capabilities change how revenue teams can act on launch signals. Worth comparing notes?",
      },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "pass");
  assert.equal(result.verdict.notes.axes.voice_do_not, 1);
});

test("eval gate: AI do-not still blocks assistant identity claims", async () => {
  const bus = createInMemoryEventBus();
  const judge = createNoopJudge(0.95, 0.6);

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: {
        ...fakeRep(),
        persona: {
          voice: "warm, precise, low-hype",
          do_not: ["Do not mention being an AI."],
          samples: [],
        },
      },
      artifact: {
        kind: "draft",
        channel: "email",
        body: "Hi Anne, as an AI assistant I noticed your launch signal.",
      },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "reject");
  assert.ok(result.rejection_reason?.includes("do-not"));
});

test("eval gate: brand voice guardrail rejects sample drift", async () => {
  const bus = createInMemoryEventBus();
  const judge = createNoopJudge(0.95, 0.6);

  const result = await evalGate(
    { judge, bus },
    {
      workspace_id: randomUUID(),
      rep: {
        ...fakeRep(),
        persona: {
          voice: "plainspoken, precise, low-hype",
          do_not: [],
          samples: [
            "Saw the launch. The timing feels worth a quick compare-notes conversation.",
            "The hiring signal is interesting because it changes the workflow conversation.",
          ],
        },
      },
      artifact: {
        kind: "draft",
        channel: "email",
        body:
          "Hi Anne, unlock unprecedented growth with our revolutionary platform that will transform everything.",
      },
      message_id: randomUUID(),
    },
  );

  assert.equal(result.decision, "reject");
  assert.ok(result.rejection_reason?.includes("canonical writing samples"));
  assert.equal(result.verdict.notes.axes.voice_sample_overlap, 0);
});
