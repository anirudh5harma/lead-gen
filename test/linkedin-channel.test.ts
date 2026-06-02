import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDryRunLinkedInTransport,
  createNativeLinkedInChannel,
  LinkedInTransportError,
} from "../core/channels/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";

function baseConversation() {
  return {
    id: randomUUID(),
    workspace_id: randomUUID(),
    rep_id: randomUUID(),
    counterparty_person_id: randomUUID(),
    counterparty_linkedin_url: "https://www.linkedin.com/in/nisha-rao",
    topic: "Series A",
  };
}

function baseDraft(channel = "linkedin_dm") {
  return {
    message_id: randomUUID(),
    channel,
    body: "Congrats on the round. Worth comparing notes?",
    eval_passed: true,
    eval_score: 0.8,
  };
}

test("linkedin channel: sends through a native session transport and emits typed events", async () => {
  const bus = createInMemoryEventBus();
  const transport = createDryRunLinkedInTransport();
  const accountId = randomUUID();
  const channel = createNativeLinkedInChannel({
    action: "linkedin_dm",
    accounts: [
      {
        id: accountId,
        display_name: "Maya LinkedIn",
        kind: "linkedin_session",
        status: "connected",
        daily_cap: 2,
        daily_used: 0,
      },
    ],
    transport,
  });
  const conversation = baseConversation();
  const draft = baseDraft();

  const result = await channel.send(conversation, draft, {
    workspace_id: conversation.workspace_id,
    bus,
    correlation_id: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(result.status, "sent");
  assert.equal(transport.sent.length, 1);
  assert.equal(transport.sent[0].target_profile_url, conversation.counterparty_linkedin_url);
  assert.deepEqual(
    bus.published.map((event) => event.event_type),
    ["message.queued", "message.sent"],
  );
  assert.equal(bus.published[1].payload.channel, "linkedin_dm");
  assert.equal(bus.published[0].payload.channel_account_id, accountId);
  assert.equal(bus.published[1].payload.channel_account_id, accountId);
});

test("linkedin channel: defers when profile, eval, or volume gate blocks send", async () => {
  const bus = createInMemoryEventBus();
  const transport = createDryRunLinkedInTransport();
  const accountId = randomUUID();
  const channel = createNativeLinkedInChannel({
    action: "linkedin_connection",
    accounts: [
      {
        id: accountId,
        display_name: "Maya LinkedIn",
        kind: "linkedin_session",
        status: "connected",
        daily_cap: 0,
        daily_used: 0,
      },
    ],
    transport,
  });

  const missingProfile = await channel.send(
    { ...baseConversation(), counterparty_linkedin_url: null },
    baseDraft("linkedin_connection"),
    { workspace_id: randomUUID(), bus },
  );
  assert.equal(missingProfile.status, "deferred");
  assert.equal(missingProfile.defer_reason, "missing_linkedin_profile");

  const failedEval = await channel.send(
    baseConversation(),
    { ...baseDraft("linkedin_connection"), eval_passed: false },
    { workspace_id: randomUUID(), bus },
  );
  assert.equal(failedEval.status, "deferred");
  assert.equal(failedEval.defer_reason, "eval_not_passed");

  const capped = await channel.send(
    baseConversation(),
    baseDraft("linkedin_connection"),
    { workspace_id: randomUUID(), bus },
  );
  assert.equal(capped.status, "deferred");
  assert.equal(capped.defer_reason, "linkedin_daily_cap_exhausted");
  assert.equal(bus.published.at(-1)?.payload.channel_account_id, accountId);
  assert.match(String(bus.published.at(-1)?.payload.detail), /daily cap/);
  assert.equal(transport.sent.length, 0);
});

test("linkedin channel: defers with specific account recovery reasons", async () => {
  const now = () => new Date("2026-06-02T10:00:00.000Z");
  const cases = [
    {
      status: "needs_reauth" as const,
      reason: "linkedin_needs_reauth",
      detail: /reauthorization/,
      retry: null,
    },
    {
      status: "rate_limited" as const,
      reason: "linkedin_rate_limited",
      detail: /rate-limited/,
      retry: "2026-06-03T10:00:00.000Z",
    },
    {
      status: "suspended" as const,
      reason: "linkedin_account_suspended",
      detail: /suspended/,
      retry: null,
    },
    {
      status: "disconnected" as const,
      reason: "linkedin_account_disconnected",
      detail: /disconnected/,
      retry: null,
    },
  ];

  for (const item of cases) {
    const bus = createInMemoryEventBus();
    const accountId = randomUUID();
    const channel = createNativeLinkedInChannel({
      action: "linkedin_dm",
      accounts: [
        {
          id: accountId,
          display_name: "Maya LinkedIn",
          kind: "linkedin_session",
          status: item.status,
          daily_cap: 10,
          daily_used: 0,
        },
      ],
      transport: createDryRunLinkedInTransport(),
      now,
    });

    const result = await channel.send(baseConversation(), baseDraft(), {
      workspace_id: randomUUID(),
      bus,
    });

    assert.equal(result.status, "deferred");
    assert.equal(result.defer_reason, item.reason);
    assert.equal(result.retry_after, item.retry);
    assert.equal(bus.published.at(-1)?.payload.channel_account_id, accountId);
    assert.match(String(bus.published.at(-1)?.payload.detail), item.detail);
  }
});

test("linkedin channel: emits account error and defers on transport failure", async () => {
  const bus = createInMemoryEventBus();
  const accountId = randomUUID();
  const retryAfter = "2026-06-02T11:00:00.000Z";
  const channel = createNativeLinkedInChannel({
    action: "linkedin_dm",
    accounts: [
      {
        id: accountId,
        display_name: "Maya LinkedIn",
        kind: "linkedin_oauth",
        status: "connected",
        daily_cap: 10,
        daily_used: 0,
      },
    ],
    transport: {
      async send() {
        throw new LinkedInTransportError("rate_limited", "Provider asked us to wait", {
          retry_after: retryAfter,
        });
      },
    },
  });

  const result = await channel.send(baseConversation(), baseDraft(), {
    workspace_id: randomUUID(),
    bus,
    correlation_id: "00000000-0000-4000-8000-000000000002",
  });

  assert.equal(result.status, "deferred");
  assert.equal(result.defer_reason, "linkedin_rate_limited");
  assert.equal(result.retry_after, retryAfter);
  assert.deepEqual(
    bus.published.map((event) => event.event_type),
    ["message.queued", "channel.account.errored", "message.deferred"],
  );
  assert.equal(bus.published[1].payload.channel_account_id, accountId);
  assert.equal(bus.published[1].payload.kind, "linkedin_oauth");
  assert.equal(bus.published[1].payload.status, "rate_limited");
  assert.match(String(bus.published[1].payload.error), /Provider asked us to wait/);
  assert.equal(bus.published[2].payload.channel_account_id, accountId);
});
