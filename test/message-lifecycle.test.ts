import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublishedEvent } from "../core/substrate/events/index.ts";
import {
  MESSAGE_LIFECYCLE_PROJECTION,
  createMessageLifecycleProjection,
  projectMessageLifecycleEvent,
} from "../core/channels/message-lifecycle.ts";

function fakePool() {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Pool;
  return { pool, calls };
}

function event(event_type: string, payload: Record<string, unknown>): PublishedEvent {
  return {
    id: randomUUID(),
    workspace_id: randomUUID(),
    event_type,
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "system",
    producer_ref: "test",
    idempotency_key: null,
    payload,
    occurred_at: new Date().toISOString(),
  };
}

test("message lifecycle projection declares the outbound message event set", () => {
  const { pool } = fakePool();
  const projection = createMessageLifecycleProjection(pool);
  assert.equal(projection.name, MESSAGE_LIFECYCLE_PROJECTION);
  assert.deepEqual(projection.eventTypes, [
    "draft.proposed",
    "draft.judged",
    "draft.rejected",
    "message.queued",
    "message.accepted",
    "message.sent",
    "message.deferred",
    "message.delivered",
    "message.bounced",
  ]);
});

test("message.accepted remains queued and records provider acceptance evidence", async () => {
  const { pool, calls } = fakePool();
  const message_id = randomUUID();
  const channel_account_id = randomUUID();
  await projectMessageLifecycleEvent(pool, event("message.accepted", {
    message_id,
    channel: "email",
    provider_request_id: "graph-request-1",
    channel_account_id,
  }));
  assert.match(calls[0]!.sql, /else 'queued'::message_status/);
  assert.equal(calls[0]!.values?.[0], message_id);
  assert.equal(calls[0]!.values?.[2], channel_account_id);
  assert.equal(
    JSON.parse(String(calls[0]!.values?.[3])).provider_request_id,
    "graph-request-1",
  );
});

test("message lifecycle projection materializes draft and channel lifecycle events", async () => {
  const { pool, calls } = fakePool();
  const conversation_id = randomUUID();
  const message_id = randomUUID();
  const rep_id = randomUUID();
  const channel_account_id = randomUUID();
  const reserved_at = new Date().toISOString();

  await projectMessageLifecycleEvent(
    pool,
    event("draft.proposed", {
      conversation_id,
      message_id,
      channel: "email",
      rep_id,
      subject: "hello",
      body: "body",
      provenance: { pattern_key: "x" },
    }),
  );
  assert.match(calls[0]!.sql, /insert into messages/);
  assert.equal(calls[0]!.values?.[0], message_id);
  assert.equal(calls[0]!.values?.[2], conversation_id);
  assert.equal(calls[0]!.values?.[3], "email");
  assert.deepEqual(JSON.parse(String(calls[0]!.values?.[7])), {
    pattern_key: "x",
  });
  const proposedProperties = JSON.parse(String(calls[0]!.values?.[8])) as {
    draft_proposed_event_id: string;
    rep_id: string;
  };
  assert.match(proposedProperties.draft_proposed_event_id, /^[0-9a-f-]{36}$/);
  assert.equal(proposedProperties.rep_id, rep_id);

  await projectMessageLifecycleEvent(
    pool,
    event("draft.judged", {
      message_id,
      eval_score: 0.82,
      passed: true,
      notes: { critique: "clear" },
    }),
  );
  assert.match(calls[1]!.sql, /eval_score/);
  assert.equal(calls[1]!.values?.[0], message_id);
  assert.equal(calls[1]!.values?.[2], 0.82);
  assert.equal(calls[1]!.values?.[3], true);
  assert.deepEqual(JSON.parse(String(calls[1]!.values?.[4])), {
    critique: "clear",
  });
  assert.match(
    JSON.parse(String(calls[1]!.values?.[5])).draft_judged_event_id,
    /^[0-9a-f-]{36}$/,
  );

  await projectMessageLifecycleEvent(
    pool,
    event("draft.rejected", {
      message_id,
      reason: "sub-threshold",
    }),
  );
  assert.match(calls[2]!.sql, /eval_notes/);
  assert.equal(calls[2]!.values?.[0], message_id);
  assert.equal(
    JSON.parse(String(calls[2]!.values?.[2])).draft_rejection_reason,
    "sub-threshold",
  );

  await projectMessageLifecycleEvent(
    pool,
    event("message.queued", {
      message_id,
      channel: "email",
      scheduled_at: null,
      channel_account_id,
      reserved_at,
    }),
  );
  assert.match(calls[3]!.sql, /update messages/);
  assert.equal(calls[3]!.values?.[0], message_id);
  assert.equal(calls[3]!.values?.[2], channel_account_id);
  assert.equal(calls[3]!.values?.[5], "email");
  const queuedProperties = JSON.parse(String(calls[3]!.values?.[4])) as {
    queued_event_id: string;
    send_reserved_at: string;
  };
  assert.match(queuedProperties.queued_event_id, /^[0-9a-f-]{36}$/);
  assert.equal(queuedProperties.send_reserved_at, reserved_at);

  await projectMessageLifecycleEvent(
    pool,
    event("message.sent", {
      message_id,
      channel: "email",
      external_id: "provider-1",
      channel_account_id,
    }),
  );
  assert.match(calls[4]!.sql, /external_id = coalesce/);
  assert.equal(calls[4]!.values?.[0], message_id);
  assert.equal(calls[4]!.values?.[2], "provider-1");
  assert.equal(calls[4]!.values?.[5], "email");
  assert.equal(calls[4]!.values?.[6], channel_account_id);

  await projectMessageLifecycleEvent(
    pool,
    event("message.deferred", {
      message_id,
      channel: "email",
      defer_reason: "daily_cap_reached",
      retry_after: null,
      detail: "0/0",
      channel_account_id,
    }),
  );
  assert.match(calls[5]!.sql, /eval_notes/);
  assert.equal(calls[5]!.values?.[0], message_id);
  assert.equal(calls[5]!.values?.[3], "email");
  assert.equal(calls[5]!.values?.[4], channel_account_id);
  const notes = JSON.parse(String(calls[5]!.values?.[2])) as {
    defer_reason: string;
    defer_detail: string | null;
    defer_event_id: string;
  };
  assert.equal(notes.defer_reason, "daily_cap_reached");
  assert.equal(notes.defer_detail, "0/0");
  assert.match(notes.defer_event_id, /^[0-9a-f-]{36}$/);

  await projectMessageLifecycleEvent(
    pool,
    event("message.delivered", {
      message_id,
      channel: "email",
      external_id: "provider-1",
      provider_event_id: "evt-1",
    }),
  );
  assert.match(calls[6]!.sql, /delivered_at/);
  assert.equal(calls[6]!.values?.[0], message_id);
  assert.equal(calls[6]!.values?.[4], "email");
  const deliveredProperties = JSON.parse(String(calls[6]!.values?.[3])) as {
    delivered_event_id: string;
    delivery_external_id: string | null;
    delivery_provider_event_id: string | null;
  };
  assert.equal(deliveredProperties.delivery_external_id, "provider-1");
  assert.equal(deliveredProperties.delivery_provider_event_id, "evt-1");
  assert.match(deliveredProperties.delivered_event_id, /^[0-9a-f-]{36}$/);

  await projectMessageLifecycleEvent(
    pool,
    event("message.bounced", {
      message_id,
      channel: "email",
      bounce_type: "hard",
      external_id: "provider-1",
      provider_event_id: "evt-2",
      reason: "recipient_suppressed",
      recipient: "anne@example.com",
      detail: "mailbox missing",
    }),
  );
  assert.match(calls[7]!.sql, /bounced/);
  assert.equal(calls[7]!.values?.[0], message_id);
  assert.equal(calls[7]!.values?.[3], "email");
  const bounceNotes = JSON.parse(String(calls[7]!.values?.[2])) as {
    bounce_type: string;
    bounce_reason: string | null;
    bounce_recipient: string | null;
    bounce_detail: string | null;
    bounce_event_id: string;
  };
  assert.equal(bounceNotes.bounce_type, "hard");
  assert.equal(bounceNotes.bounce_reason, "recipient_suppressed");
  assert.equal(bounceNotes.bounce_recipient, "anne@example.com");
  assert.equal(bounceNotes.bounce_detail, "mailbox missing");
  assert.match(bounceNotes.bounce_event_id, /^[0-9a-f-]{36}$/);
});
