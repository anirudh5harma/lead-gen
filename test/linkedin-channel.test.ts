import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDryRunLinkedInTransport,
  createNativeLinkedInChannel,
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
  const channel = createNativeLinkedInChannel({
    action: "linkedin_dm",
    accounts: [
      {
        id: "li_1",
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
});

test("linkedin channel: defers when profile, eval, or volume gate blocks send", async () => {
  const bus = createInMemoryEventBus();
  const transport = createDryRunLinkedInTransport();
  const channel = createNativeLinkedInChannel({
    action: "linkedin_connection",
    accounts: [
      {
        id: "li_1",
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
  assert.equal(transport.sent.length, 0);
});
