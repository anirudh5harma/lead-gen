import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createHeuristicJudge } from "../core/agents/eval/index.ts";
import { createInMemoryRepMemory } from "../core/agents/memory/index.ts";
import {
  createDryRunEmailTransport,
  createOwnedDomainEmailChannel,
} from "../core/channels/email/index.ts";
import type { GraphCompany, GraphPerson } from "../core/graph/types.ts";
import type { Conversation, Message, Rep } from "../core/primitives/index.ts";
import {
  createInMemoryVerticalSliceStore,
  createReplyToEmailPlayWorkflow,
  REPLY_TO_EMAIL_PLAY_WORKFLOW,
  wireInMemoryVerticalSliceMessageLifecycleProjection,
} from "../core/plays/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";

test("reply email Play drafts, judges, requests approval, then sends", async () => {
  const workspace_id = randomUUID();
  const rep_id = randomUUID();
  const company_id = randomUUID();
  const person_id = randomUUID();
  const conversation_id = randomUUID();
  const outbound_message_id = randomUUID();
  const inbound_message_id = randomUUID();
  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const now = new Date().toISOString();

  const rep: Rep = {
    id: rep_id,
    workspace_id,
    name: "Maya",
    role: "sdr",
    status: "active",
    persona: {
      voice: "Warm, precise, low-hype.",
      story: "Maya helps teams respond to fresh buying intent.",
      kpis: ["positive replies"],
      do_not: ["Do not mention being an AI."],
      samples: [],
    },
    channels: ["email"],
    autonomy: { channels: { email: { approval: "always" } }, global: {} },
    created_at: now,
    updated_at: now,
  };
  const company: GraphCompany = {
    id: company_id,
    workspace_id,
    name: "Acme Payroll",
    domain: "acme.example",
    industry: "Fintech",
    size_bucket: "51-200",
    description: null,
    properties: {},
    provenance: {},
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const person: GraphPerson = {
    id: person_id,
    workspace_id,
    full_name: "Nisha Rao",
    given_name: "Nisha",
    family_name: "Rao",
    title: "Founder",
    company_id,
    emails: ["nisha@acme.example"],
    phones: [],
    linkedin_url: null,
    x_handle: null,
    properties: {},
    provenance: {},
    embedded_at: null,
    created_at: now,
    updated_at: now,
  };
  const conversation: Conversation = {
    id: conversation_id,
    workspace_id,
    rep_id,
    counterparty_person_id: person_id,
    counterparty_company_id: company_id,
    status: "awaiting_us",
    origin_signal_id: null,
    topic: "Series A expansion",
    started_at: now,
    last_activity_at: now,
    closed_at: null,
    properties: {},
  };
  const outbound: Message = {
    id: outbound_message_id,
    workspace_id,
    conversation_id,
    channel: "email",
    direction: "outbound",
    status: "replied",
    subject: "Series A expansion",
    body: "Congrats on the Series A. Worth comparing notes?",
    body_html: null,
    external_id: "outbound-1",
    external_thread_id: null,
    channel_account_id: null,
    eval_score: 0.8,
    eval_passed: true,
    eval_notes: null,
    intent_class: null,
    intent_confidence: null,
    scheduled_at: null,
    sent_at: now,
    delivered_at: now,
    replied_at: now,
    properties: {},
    provenance: {},
    created_at: now,
  };
  const inbound: Message = {
    id: inbound_message_id,
    workspace_id,
    conversation_id,
    channel: "email",
    direction: "inbound",
    status: "delivered",
    subject: "Re: Series A expansion",
    body: "Happy to chat. What did you have in mind?",
    body_html: null,
    external_id: "inbound-1",
    external_thread_id: null,
    channel_account_id: null,
    eval_score: null,
    eval_passed: null,
    eval_notes: { intent_reason: "Asked to continue the conversation." },
    intent_class: "positive",
    intent_confidence: 0.92,
    scheduled_at: null,
    sent_at: now,
    delivered_at: now,
    replied_at: now,
    properties: {},
    provenance: {
      from_email: "nisha@acme.example",
      matched_outbound_message_id: outbound_message_id,
    },
    created_at: now,
  };

  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const memory = createInMemoryRepMemory();
  const pattern_key = "conversation:email|intent:positive|company:acme-payroll|stage:reply";
  const exemplar = await memory.procedural.add(
    { workspace_id, rep_id },
    {
      pattern_key,
      initial_score: 0.91,
      exemplar: {
        body: "Happy to compare notes. The useful frame is what changed, what risk you want to avoid, and whether there is a focused next step.",
      },
    },
  );
  const store = createInMemoryVerticalSliceStore({
    reps: [rep],
    signals: [],
    persons: [person],
    companies: [company],
    conversations: [conversation],
    messages: [outbound, inbound],
  });
  await wireInMemoryVerticalSliceMessageLifecycleProjection(store, bus);
  await bus.subscribe("approval.requested", async (event) => {
    await runtime.resolveApproval(event.payload.approval_id, { decision: "approved" });
  });
  const transport = createDryRunEmailTransport();
  runtime.register(
    createReplyToEmailPlayWorkflow({
      store,
      memory,
      judge: createHeuristicJudge({ threshold: 0.55 }),
      email: createOwnedDomainEmailChannel({
        accounts: [{
          id: randomUUID(),
          display_name: "maya@example.com",
          kind: "email_domain",
          status: "connected",
          daily_cap: 10,
          daily_used: 0,
        }],
        transport,
      }),
      bus,
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: REPLY_TO_EMAIL_PLAY_WORKFLOW,
    play_id,
    play_run_id,
    input: {
      workspace_id,
      play_id,
      play_run_id,
      rep_id,
      conversation_id,
      inbound_message_id,
      reply_approval: "always",
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  const completed = await runtime.get(run.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.output?.decision, "sent");
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0]?.to, "nisha@acme.example");

  const eventTypes = bus.published.map((event) => event.event_type);
  for (const eventType of [
    "play.run.started",
    "rep.role.completed",
    "draft.proposed",
    "draft.judged",
    "approval.requested",
    "approval.decided",
    "message.queued",
    "message.sent",
    "play.run.completed",
  ]) {
    assert.ok(eventTypes.includes(eventType), `expected ${eventType}`);
  }
  assert.ok(eventTypes.indexOf("draft.judged") < eventTypes.indexOf("message.sent"));

  const state = await store.snapshot();
  const reply = state.messages.find((message) => message.id === completed?.output?.message_id);
  assert.equal(reply?.status, "sent");
  assert.equal(reply?.provenance.inbound_message_id, inbound_message_id);
  assert.equal(reply?.provenance.pattern_key, pattern_key);
  assert.deepEqual(reply?.provenance.exemplar_ids, [exemplar.id]);
  assert.match(reply?.body ?? "", /what risk you want to avoid/);

  const roleEvent = bus.published.find(
    (event) =>
      event.event_type === "rep.role.completed" &&
      event.payload.action === "draft_email_reply",
  );
  assert.equal(roleEvent?.payload.output.pattern_key, pattern_key);
  assert.deepEqual(roleEvent?.payload.output.exemplar_ids, [exemplar.id]);

  assert.equal(completed?.output?.pattern_key, pattern_key);
});
