import { test } from "node:test";
import assert from "node:assert/strict";
import { runFirstVerticalSlice } from "../core/plays/index.ts";
import { createResendEmailTransport } from "../core/channels/email/index.ts";
import { parseRssSignals } from "../core/signals/index.ts";
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
  const llm: LLMClient = {
    async complete() {
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

  const result = await runFirstVerticalSlice({ writerLlm: llm });
  assert.equal(result.output.decision, "sent");
  assert.match(result.state.messages[0].body ?? "", /distributed payroll/);
});

test("email transport: Resend adapter posts the provider payload and returns provider id", async () => {
  let body: unknown;
  const transport = createResendEmailTransport({
    apiKey: "test-key",
    baseUrl: "https://resend.test",
    fetchImpl: (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }) as typeof fetch,
  });

  const result = await transport.send({
    from: "maya@example.com",
    to: "nisha@example.com",
    subject: "Hello",
    body: "Body",
    account_id: "acct_1",
  });

  assert.equal(result.external_id, "email_123");
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
