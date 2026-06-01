import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { composeRep } from "../core/agents/reps/compose.ts";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import { createInMemoryRepMemory } from "../core/agents/memory/index.ts";
import {
  createLinkedInWriterRole,
  createReplyDraftRole,
  createReplierRole,
} from "../core/agents/reps/index.ts";
import type {
  CompletionRequest,
  CompletionResponse,
  LLMClient,
} from "../core/agents/llm/types.ts";
import { createFixedIntentClassifier } from "../core/channels/email/intent.ts";
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

test("replier role classifies inbound replies and writes episodic memory", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const replier = createReplierRole({
    classifier: createFixedIntentClassifier("positive", 0.94, "Asked for a time."),
  });

  const result = await replier.invoke(
    {
      conversation: {
        id: randomUUID(),
        channel: "email",
        prior_outbound_subject: "Series A timing",
        prior_outbound_excerpt: "Saw the funding news and thought it might matter.",
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Series A timing",
        body_text: "Tuesday 3pm works.",
        from_email: "nisha@example.com",
        received_at: new Date().toISOString(),
      },
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.equal(result.classification.intent, "positive");
  assert.deepEqual(result.outcome, { kind: "positive_reply", score: 1 });
  assert.equal(result.handoff_required, true);
  const recent = await memory.episodic.recent({ workspace_id: rep.workspace_id, rep_id: rep.id });
  assert.equal(recent[0]?.kind, "reply.classified");
  assert.match(recent[0]?.content ?? "", /positive/);
});

test("reply draft role retrieves procedural memory for the reply intent", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const pattern_key = "conversation:email|intent:positive|company:acme-payroll|stage:reply";
  const exemplar = await memory.procedural.add(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      pattern_key,
      initial_score: 0.88,
      exemplar: {
        body: "Happy to compare notes. The useful frame is what changed, what risk you want to avoid, and whether there is a focused next step.",
      },
    },
  );
  const replier = createReplyDraftRole();

  const draft = await replier.invoke(
    {
      conversation: {
        id: randomUUID(),
        topic: "Series A expansion",
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Series A expansion",
        body_text: "Happy to chat. What did you have in mind?",
        from_email: "nisha@example.com",
        intent: "positive",
      },
      counterparty: {
        name: "Nisha Rao",
        given_name: "Nisha",
        company_name: "Acme Payroll",
      },
      prior_outbound: {
        subject: "Series A expansion",
        body_text: "Congrats on the round. Worth comparing notes?",
      },
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.equal(draft.pattern_key, pattern_key);
  assert.deepEqual(draft.exemplar_ids, [exemplar.id]);
  assert.equal(draft.procedural_exemplars.length, 1);
  assert.match(draft.body, /what changed/);
});
