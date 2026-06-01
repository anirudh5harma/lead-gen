import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { composeRep } from "../core/agents/reps/compose.ts";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import { createInMemoryRepMemory } from "../core/agents/memory/index.ts";
import { createLinkedInWriterRole } from "../core/agents/reps/index.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "../core/agents/llm/types.ts";
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

test("linkedin writer role uses Rep voice, workspace context, and procedural memory", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const pattern_key = "icp:fintech-founder|signal:funding|stage:cold_open|channel:linkedin_dm";
  const exemplar = await memory.procedural.add(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      pattern_key,
      initial_score: 0.9,
      exemplar: { body: "Congrats on the raise. Useful timing to compare notes." },
    },
  );
  const calls: CompletionRequest[] = [];
  const llm: LLMClient = {
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content: JSON.stringify({ body: "Nisha, saw the Series A. Worth comparing notes?" }),
        model: "test-model",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
  const writer = createLinkedInWriterRole({ llm });

  const draft = await writer.invoke(
    {
      action: "linkedin_dm",
      pattern_key,
      research: {
        signal_summary: "Acme Payroll announced a Series A.",
        counterparty_summary: "Nisha Rao, Founder at Acme Payroll.",
      },
      person: { full_name: "Nisha Rao", given_name: "Nisha" },
      company: { name: "Acme Payroll", industry: "Fintech" },
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
      workspace_context_markdown: "Workspace: Bombsell watches funding signals.",
    },
  );

  assert.equal(draft.body, "Nisha, saw the Series A. Worth comparing notes?");
  assert.deepEqual(draft.exemplar_ids, [exemplar.id]);
  assert.equal(calls.length, 1);
  const prompt = calls[0].messages.map((message) => message.content).join("\n");
  assert.match(prompt, /Voice: warm, direct/);
  assert.match(prompt, /Workspace: Bombsell watches funding signals/);
  assert.match(prompt, /Congrats on the raise/);
});
