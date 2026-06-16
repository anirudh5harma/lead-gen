import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { composeRep } from "../core/agents/reps/compose.ts";
import { createNoopJudge } from "../core/agents/eval/judge.ts";
import { createInMemoryRepMemory } from "../core/agents/memory/index.ts";
import {
  createWriterRole,
  createLinkedInWriterRole,
  createReplyDraftRole,
  createReplierRole,
} from "../core/agents/reps/index.ts";
import {
  createSelectedOutreachSkill,
} from "../core/agents/skills/outreach.ts";
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

test("email writer role injects selected Play Skill and skill-versioned memory", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const basePatternKey = "icp:fintech-founder|signal:funding|stage:cold_open";
  const skill = createSelectedOutreachSkill({
    channel: "email",
    stage: "cold_open",
    signal_kind: "funding",
    base_pattern_key: basePatternKey,
    slot_values: {
      signal_hook: "Acme Payroll announced a Series A.",
      why_now: "Fresh funding usually changes GTM priorities.",
      inferred_problem: "Hiring and pipeline pressure may rise together.",
      reply_question: "Worth comparing notes?",
    },
  });
  const exemplar = await memory.procedural.add(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      pattern_key: skill.pattern_key,
      initial_score: 0.93,
      exemplar: { subject: "series a timing", body: "Saw the round. Worth comparing notes?" },
    },
  );
  const calls: CompletionRequest[] = [];
  const llm: LLMClient = {
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content: JSON.stringify({
          subject: "series a timing",
          body: "Nisha, saw the Series A. Worth comparing notes on pipeline timing?",
        }),
        model: "test-model",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };

  const draft = await createWriterRole({ llm }).invoke(
    {
      channel: "email",
      research: {
        signal_summary: "Acme Payroll announced a Series A.",
        counterparty_summary: "Nisha Rao, Founder at Acme Payroll.",
        pattern_key: basePatternKey,
      },
      recipient_name: "Nisha",
      personalization_context_markdown: "## Signal Timing And Why Now\n- Fresh funding.",
      skill,
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.equal(draft.pattern_key, skill.pattern_key);
  assert.equal(draft.seed_pattern_key, null);
  assert.equal(draft.skill?.skill_key, "signal_problem_probe");
  assert.deepEqual(draft.exemplar_ids, [exemplar.id]);
  const prompt = calls[0].messages.map((message) => message.content).join("\n");
  assert.match(prompt, /Selected Play Skill: Signal Problem Probe/);
  assert.match(prompt, /signal_problem_probe@v1/);
  assert.match(prompt, /Acme Payroll announced a Series A/);
});

test("outreach skill selection honors a compatible preferred campaign skill", () => {
  const skill = createSelectedOutreachSkill({
    channel: "email",
    stage: "cold_open",
    signal_kind: "funding",
    base_pattern_key: "icp:fintech-founder|signal:funding|stage:cold_open",
    preferred_skill_key: "peer_proof_micro_case",
    preferred_skill_version: "v1",
    slot_values: {
      signal_hook: "Acme Payroll announced a Series A.",
      peer_pattern: "Recent fintech founders replied to concise pipeline-risk proof.",
      counterparty_context: "Nisha Rao, Founder at Acme Payroll",
      reply_question: "Seeing the same pattern after the round?",
    },
  });

  assert.equal(skill.skill_key, "peer_proof_micro_case");
  assert.equal(skill.version, "v1");
  assert.match(skill.pattern_key, /skill:peer_proof_micro_case@v1/);
  assert.equal(
    skill.slot_values.peer_pattern,
    "Recent fintech founders replied to concise pipeline-risk proof.",
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

test("replier role treats meeting intent as a positive handoff", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const replier = createReplierRole({
    classifier: createFixedIntentClassifier(
      "meeting_intent",
      0.96,
      "Asked to schedule time.",
    ),
  });

  const result = await replier.invoke(
    {
      conversation: {
        id: randomUUID(),
        channel: "email",
        prior_outbound_subject: "Hiring signal",
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Hiring signal",
        body_text: "Can you send me two times next week?",
        from_email: "maya@example.com",
        received_at: "2026-06-16T10:00:00.000Z",
      },
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.equal(result.classification.intent, "meeting_intent");
  assert.deepEqual(result.outcome, { kind: "positive_reply", score: 1 });
  assert.equal(result.handoff_required, true);
  assert.equal(result.semantic_facts.latest_reply_intent, "meeting_intent");
});

test("replier role extracts reply objections and preferences into semantic memory", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const personId = randomUUID();
  const companyId = randomUUID();
  const replier = createReplierRole({
    classifier: createFixedIntentClassifier(
      "neutral",
      0.81,
      "Asked for more detail before scheduling.",
    ),
  });

  const result = await replier.invoke(
    {
      conversation: {
        id: randomUUID(),
        channel: "email",
        prior_outbound_subject: "Security review",
        prior_outbound_excerpt: "Worth comparing notes on the rollout?",
      },
      counterparty: {
        person_id: personId,
        company_id: companyId,
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Security review",
        body_text:
          "We need to review security before booking time. Prefer email first; send over two concrete options for next week.",
        from_email: "nisha@example.com",
        received_at: "2026-06-02T09:00:00.000Z",
      },
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.deepEqual(result.semantic_subjects, [
    `person:${personId}`,
    `company:${companyId}`,
  ]);
  assert.equal(result.semantic_facts.latest_reply_intent, "neutral");
  assert.match(String(result.semantic_facts.objection), /review security/);
  assert.match(String(result.semantic_facts.preference), /Prefer email first/);
  assert.match(String(result.semantic_facts.requested_next_step), /send over two concrete options/);
  assert.match(String(result.semantic_facts.timing), /next week/);

  const personMemory = await memory.semantic.get(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    "person",
    personId,
  );
  const companyMemory = await memory.semantic.get(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    "company",
    companyId,
  );
  assert.equal(personMemory?.facts.latest_reply_intent, "neutral");
  assert.match(String(personMemory?.facts.objection), /review security/);
  assert.match(String(companyMemory?.facts.latest_contact_objection), /review security/);
  assert.match(String(companyMemory?.facts.latest_contact_preference), /Prefer email first/);
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

test("reply draft role routes procedural memory by extracted reply facts", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const personId = randomUUID();
  const companyId = randomUUID();
  const broadPatternKey = "conversation:email|intent:neutral|company:acme-payroll|stage:reply";
  const specificPatternKey = `${broadPatternKey}|objection:review|next:send-details|seniority:founder`;
  const broad = await memory.procedural.add(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      pattern_key: broadPatternKey,
      initial_score: 0.95,
      exemplar: {
        body: "Happy to keep this simple. If timing is off, I can step back.",
      },
    },
  );
  const specific = await memory.procedural.add(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      pattern_key: specificPatternKey,
      initial_score: 0.72,
      exemplar: {
        body: "Happy to send the security review notes first. I can keep it to two concrete options and then you can decide whether a call is useful.",
      },
    },
  );
  await memory.semantic.upsert(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      subject_type: "person",
      subject_id: personId,
      facts: {
        objection: "needs to review security before booking time",
        requested_next_step: "send over two concrete options",
      },
      confidence: 0.81,
    },
  );
  const replier = createReplyDraftRole();

  const draft = await replier.invoke(
    {
      conversation: {
        id: randomUUID(),
        topic: "Security review",
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Security review",
        body_text: "Can you send over what you mean before we book time?",
        from_email: "nisha@example.com",
        intent: "neutral",
      },
      counterparty: {
        name: "Nisha Rao",
        person_id: personId,
        given_name: "Nisha",
        title: "Founder",
        company_id: companyId,
        company_name: "Acme Payroll",
      },
      prior_outbound: null,
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.equal(draft.pattern_key, specificPatternKey);
  assert.equal(
    draft.seed_pattern_key,
    `${specificPatternKey}|skill:reply_objection_clarifier@v1`,
  );
  assert.equal(draft.skill?.skill_key, "reply_objection_clarifier");
  assert.deepEqual(draft.exemplar_ids, [specific.id]);
  assert.notDeepEqual(draft.exemplar_ids, [broad.id]);
  assert.match(draft.body, /security review notes/);
});

test("reply draft role exposes a specific seed key when it falls back to broad memory", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const personId = randomUUID();
  const broadPatternKey = "conversation:email|intent:neutral|company:acme-payroll|stage:reply";
  const specificPatternKey = `${broadPatternKey}|objection:review|next:send-details|seniority:founder`;
  const broad = await memory.procedural.add(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      pattern_key: broadPatternKey,
      initial_score: 0.88,
      exemplar: {
        body: "Happy to keep this crisp and send the useful context first.",
      },
    },
  );
  await memory.semantic.upsert(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      subject_type: "person",
      subject_id: personId,
      facts: {
        objection: "needs security review before meeting",
        requested_next_step: "send details first",
      },
      confidence: 0.84,
    },
  );

  const draft = await createReplyDraftRole().invoke(
    {
      conversation: {
        id: randomUUID(),
        topic: "Security review",
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Security review",
        body_text: "Can you send details first?",
        from_email: "nisha@example.com",
        intent: "neutral",
      },
      counterparty: {
        name: "Nisha Rao",
        person_id: personId,
        given_name: "Nisha",
        title: "Founder",
        company_name: "Acme Payroll",
      },
      prior_outbound: null,
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.equal(draft.pattern_key, broadPatternKey);
  assert.equal(
    draft.seed_pattern_key,
    `${specificPatternKey}|skill:reply_objection_clarifier@v1`,
  );
  assert.deepEqual(draft.exemplar_ids, [broad.id]);
});

test("reply draft role injects semantic memory into LLM replies", async () => {
  const rep = fakeRep();
  const memory = createInMemoryRepMemory();
  const personId = randomUUID();
  const companyId = randomUUID();
  await memory.semantic.upsert(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      subject_type: "person",
      subject_id: personId,
      facts: {
        objection: "wants a focused security review before meeting",
        preferred_next_step: "send two concrete options",
      },
      confidence: 0.82,
    },
  );
  await memory.semantic.upsert(
    { workspace_id: rep.workspace_id, rep_id: rep.id },
    {
      subject_type: "company",
      subject_id: companyId,
      facts: { priority: "reduce manual payroll ops before Q3" },
      confidence: 0.76,
    },
  );
  const calls: CompletionRequest[] = [];
  const llm: LLMClient = {
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      calls.push(req);
      return {
        content: JSON.stringify({
          subject: "Re: Series A expansion",
          body: "Hi Nisha,\n\nHappy to keep this focused around the review and next step.\n\n-Maya",
        }),
        model: "test-model",
        finish_reason: "stop",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    },
  };
  const replier = createReplyDraftRole({ llm });

  const draft = await replier.invoke(
    {
      conversation: {
        id: randomUUID(),
        topic: "Series A expansion",
      },
      inbound: {
        message_id: randomUUID(),
        subject: "Re: Series A expansion",
        body_text: "Can you send over what you mean before we book time?",
        from_email: "nisha@example.com",
        intent: "neutral",
      },
      counterparty: {
        name: "Nisha Rao",
        person_id: personId,
        given_name: "Nisha",
        title: "Founder",
        company_id: companyId,
        company_name: "Acme Payroll",
      },
      prior_outbound: null,
    },
    {
      rep,
      tool_context: { workspace_id: rep.workspace_id, rep_id: rep.id },
      memory,
      judge: createNoopJudge(),
    },
  );

  assert.deepEqual(draft.semantic_subjects, [
    `person:${personId}`,
    `company:${companyId}`,
  ]);
  assert.equal(draft.semantic_memory.length, 2);
  const prompt = calls[0].messages.map((message) => message.content).join("\n");
  assert.match(prompt, /Known memory facts/);
  assert.match(prompt, /focused security review/);
  assert.match(prompt, /reduce manual payroll ops/);
});
