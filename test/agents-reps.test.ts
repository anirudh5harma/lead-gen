import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { composeRep } from "../core/agents/reps/compose.ts";
import type { RoleAgent } from "../core/agents/reps/types.ts";
import type { Rep } from "../core/primitives/rep.ts";

const inlineWriterStub: RoleAgent<unknown, unknown> = {
  kind: "writer",
  name: "writer.test_stub",
  async invoke() {
    throw new Error("test stub");
  },
};

function fakeRep(): Rep {
  return {
    id: randomUUID(),
    workspace_id: randomUUID(),
    name: "Maya",
    role: "sdr",
    status: "active",
    persona: {
      voice: "warm, direct",
      kpis: ["positive replies"],
      do_not: [],
      samples: [],
    },
    channels: ["email"],
    autonomy: { channels: {}, global: {} },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test("composeRep: exposes bound roles", () => {
  const rep = fakeRep();
  const composed = composeRep(rep, { writer: inlineWriterStub });
  assert.equal(composed.role("writer").kind, "writer");
});

test("composeRep: missing role throws with a clear message", () => {
  const rep = fakeRep();
  const composed = composeRep(rep, {});
  assert.throws(
    () => composed.role("writer"),
    /has no 'writer' role agent bound/,
  );
});
