import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInMemoryVerticalSliceStore,
  runFirstVerticalSlice,
} from "../core/plays/index.ts";
import {
  createDryRunEmailTransport,
  createOwnedDomainEmailChannel,
  createResendEmailTransport,
} from "../core/channels/email/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { ingestManualSignal, parseRssSignals } from "../core/signals/index.ts";
import type { LLMClient } from "../core/agents/llm/types.ts";

test("first vertical slice: signal -> play -> judged draft -> email -> outcome -> procedural memory", async () => {
  const result = await runFirstVerticalSlice();

  assert.equal(result.output.decision, "sent");
  assert.equal(result.sentEmailCount, 1);
  assert.ok(result.output.conversation_id);
  assert.ok(result.output.message_id);
  assert.ok(result.output.outcome_id);
  assert.ok(result.output.eval_score >= 0.55);
  assert.ok(result.proceduralScoreAfterOutcome > 0.55);

  for (const eventType of [
    "signal.ingested",
    "play.run.started",
    "conversation.opened",
    "draft.proposed",
    "draft.judged",
    "message.queued",
    "message.sent",
    "outcome.recorded",
    "rep.memory.procedural.updated",
    "play.run.completed",
  ]) {
    assert.ok(
      result.eventTypes.includes(eventType),
      `expected ${eventType} in ${result.eventTypes.join(", ")}`,
    );
  }

  assert.ok(
    result.eventTypes.indexOf("draft.judged") < result.eventTypes.indexOf("message.sent"),
    "hot-path eval must happen before channel send",
  );

  const [message] = result.state.messages;
  assert.equal(message.status, "sent");
  assert.equal(message.eval_passed, true);
  assert.ok(message.external_id);

  const [outcome] = result.state.outcomes;
  assert.equal(outcome.kind, "positive_reply");
  assert.equal(outcome.attributed_message_id, message.id);
});

test("first vertical slice: approval gate parks then sends after approval", async () => {
  const result = await runFirstVerticalSlice({
    emailApproval: "always",
    autoApprove: true,
  });

  assert.equal(result.output.decision, "sent");
  assert.ok(result.eventTypes.includes("approval.requested"));
  assert.ok(result.eventTypes.includes("approval.decided"));
  assert.ok(
    result.eventTypes.indexOf("approval.requested") <
      result.eventTypes.indexOf("message.sent"),
  );
});

test("first vertical slice: edited approval draft is rejudged before send", async () => {
  const result = await runFirstVerticalSlice({
    emailApproval: "always",
    autoApprove: true,
    approvalNote: JSON.stringify({
      type: "draft_override",
      subject: "Nisha, quick note on the Series A",
      body: "Hi Nisha,\n\nSaw Acme Payroll raised a Series A and is expanding finance workflows for distributed teams. That usually creates a good moment to tighten founder-led pipeline quality before hiring ramps.\n\nWorth comparing notes this week?\n\n-Maya",
    }),
  });

  assert.equal(result.output.decision, "sent");
  assert.equal(result.state.messages[0].subject, "Nisha, quick note on the Series A");
  assert.match(result.state.messages[0].body ?? "", /founder-led pipeline quality/);
  assert.equal(result.state.messages[0].properties.human_edited, true);
  assert.equal(
    result.eventTypes.filter((eventType) => eventType === "draft.judged").length,
    2,
  );
  assert.ok(
    result.eventTypes.indexOf("approval.decided") <
      result.eventTypes.lastIndexOf("draft.judged"),
  );
  assert.ok(
    result.eventTypes.lastIndexOf("draft.judged") <
      result.eventTypes.indexOf("message.sent"),
  );
});

test("first vertical slice: play channel daily cap defers before send", async () => {
  const result = await runFirstVerticalSlice({
    playChannelPolicy: {
      channel: "email",
      daily_cap: 0,
      approval: "none",
    },
  });

  assert.equal(result.output.decision, "deferred");
  assert.equal(result.sentEmailCount, 0);
  assert.ok(result.eventTypes.includes("message.deferred"));
  assert.ok(!result.eventTypes.includes("message.sent"));
  assert.equal(result.state.messages[0].status, "deferred");
  assert.equal(result.state.messages[0].properties.defer_reason, "play_channel_daily_cap");
});

test("first vertical slice: LLM-backed writer path is usable behind the same judge gate", async () => {
  const calls: string[] = [];
  const llm: LLMClient = {
    async complete(req) {
      calls.push(req.messages.map((message) => message.content).join("\n"));
      return {
        content: JSON.stringify({
          subject: "Congrats on the Series A",
          body: "Hi Nisha,\n\nSaw the Series A and the distributed payroll expansion. That usually creates a sharp moment to tighten pipeline quality before hiring ramps.\n\nWorth comparing notes this week?\n\n-Maya",
        }),
        model: "mock-llm",
        finish_reason: "stop",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    },
  };

  const result = await runFirstVerticalSlice({
    writerLlm: llm,
    workspaceContextMarkdown:
      "# Bombsell Workspace Context\n\n## Pending Review\n- approval=ap_123 kind=outbound.email.send",
  });
  assert.equal(result.output.decision, "sent");
  assert.match(result.state.messages[0].body ?? "", /distributed payroll/);
  assert.match(calls[0] ?? "", /Bombsell Workspace Context/);
  assert.match(calls[0] ?? "", /Pending Review/);
});

test("email transport: Resend adapter posts the provider payload and returns provider id", async () => {
  let body: unknown;
  let idempotencyHeader: string | null = null;
  const transport = createResendEmailTransport({
    apiKey: "test-key",
    baseUrl: "https://resend.test",
    fetchImpl: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      idempotencyHeader = new Headers(init?.headers).get("Idempotency-Key");
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }) as typeof fetch,
  });

  const result = await transport.send({
    from: "maya@example.com",
    to: "nisha@example.com",
    subject: "Hello",
    body: "Body",
    account_id: "acct_1",
    idempotency_key: "message/msg_1",
  });

  assert.equal(result.external_id, "email_123");
  assert.equal(idempotencyHeader, "message/msg_1");
  assert.deepEqual(body, {
    from: "maya@example.com",
    to: ["nisha@example.com"],
    subject: "Hello",
    text: "Body",
    headers: {
      "X-Bombsell-Channel-Account": "acct_1",
    },
  });
});

test("email transport: dry-run retries collapse by durable message idempotency key", async () => {
  const transport = createDryRunEmailTransport();
  const envelope = {
    from: "maya@example.com",
    to: "nisha@example.com",
    subject: "Hello",
    body: "Body",
    account_id: "acct_1",
    idempotency_key: "message/msg_1",
  };

  const first = await transport.send(envelope);
  const retry = await transport.send(envelope);

  assert.equal(retry.external_id, first.external_id);
  assert.equal(transport.sent.length, 1);
});

test("email channel: replaying a successful dry-run send does not spend capacity twice", async () => {
  const account = {
    id: "account_1",
    display_name: "maya@example.com",
    kind: "email_domain" as const,
    daily_cap: 2,
    daily_used: 0,
    status: "connected" as const,
  };
  const transport = createDryRunEmailTransport();
  const channel = createOwnedDomainEmailChannel({ accounts: [account], transport });
  const bus = createInMemoryEventBus();
  const conversation = {
    id: "conversation_1",
    workspace_id: "00000000-0000-4000-8000-000000000001",
    rep_id: "rep_1",
    counterparty_person_id: "person_1",
    counterparty_email: "nisha@example.com",
  };
  const draft = {
    message_id: "00000000-0000-4000-8000-000000000002",
    channel: "email",
    subject: "Hello",
    body: "Body",
    eval_passed: true,
  };

  const first = await channel.send(conversation, draft, {
    workspace_id: conversation.workspace_id,
    bus,
  });
  const retry = await channel.send(conversation, draft, {
    workspace_id: conversation.workspace_id,
    bus,
  });

  assert.deepEqual(retry, first);
  assert.equal(account.daily_used, 1);
  assert.equal(transport.sent.length, 1);
  assert.deepEqual(
    bus.published.map((event) => event.event_type),
    ["message.queued", "message.sent"],
  );
});

test("signal source: RSS parser creates typed Signals", async () => {
  const signals = await parseRssSignals({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    xml: `<?xml version="1.0"?><rss><channel><item><title>Acme launched</title><link>https://example.com/acme</link><description>Launch note</description><pubDate>Mon, 25 May 2026 10:00:00 GMT</pubDate></item></channel></rss>`,
  });

  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, "press_mention");
  assert.equal(signals[0].title, "Acme launched");
  assert.equal(signals[0].url, "https://example.com/acme");
});

test("manual pre-matched signal emits signal.matched for Play triggers", async () => {
  const bus = createInMemoryEventBus();
  await ingestManualSignal(
    {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      kind: "funding",
      title: "Acme raised a Series A",
      match_score: 0.86,
      icp_segment: "fintech-founder",
    },
    {
      store: createInMemoryVerticalSliceStore({
        reps: [],
        signals: [],
        persons: [],
      }),
      bus,
      producer_ref: "test:manual-signal",
    },
  );

  assert.deepEqual(
    bus.published.map((event) => event.event_type),
    ["signal.ingested", "signal.matched"],
  );
  const matched = bus.published[1]?.payload as {
    match_score?: number;
    icp_segment?: string;
  };
  assert.equal(matched.match_score, 0.86);
  assert.equal(matched.icp_segment, "fintech-founder");
});
