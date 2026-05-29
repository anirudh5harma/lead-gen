import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublishedEvent } from "../core/substrate/events/index.ts";
import {
  REPLY_LIFECYCLE_PROJECTION,
  createReplyLifecycleProjection,
  projectReplyLifecycleEvent,
} from "../core/channels/reply-lifecycle.ts";

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

test("reply lifecycle projection declares reply event set", () => {
  const { pool } = fakePool();
  const projection = createReplyLifecycleProjection(pool);
  assert.equal(projection.name, REPLY_LIFECYCLE_PROJECTION);
  assert.deepEqual(projection.eventTypes, ["reply.received", "reply.classified"]);
});

test("reply lifecycle projection materializes inbound and classified replies", async () => {
  const { pool, calls } = fakePool();
  const conversation_id = randomUUID();
  const inbound_message_id = randomUUID();
  const outbound_message_id = randomUUID();
  const channel_account_id = randomUUID();
  const received_at = new Date().toISOString();

  await projectReplyLifecycleEvent(
    pool,
    event("reply.received", {
      conversation_id,
      message_id: inbound_message_id,
      channel: "email",
      matched_outbound_message_id: outbound_message_id,
      external_id: "inbound-1",
      external_thread_id: "thread-1",
      in_reply_to: "outbound-1",
      references: ["outbound-1"],
      from: { email: "anne@example.com", name: "Anne" },
      subject: "Re: Series A",
      body_text: "Happy to chat.",
      body_html: "<p>Happy to chat.</p>",
      received_at,
      channel_account_id,
    }),
  );
  assert.match(calls[0]!.sql, /insert into messages/);
  assert.equal(calls[0]!.values?.[0], inbound_message_id);
  assert.equal(calls[0]!.values?.[2], conversation_id);
  assert.equal(calls[0]!.values?.[3], "email");
  assert.equal(calls[0]!.values?.[7], "inbound-1");
  assert.equal(calls[0]!.values?.[9], channel_account_id);
  const provenance = JSON.parse(String(calls[0]!.values?.[11])) as {
    from_email: string;
    matched_outbound_message_id: string;
  };
  assert.equal(provenance.from_email, "anne@example.com");
  assert.equal(provenance.matched_outbound_message_id, outbound_message_id);

  assert.match(calls[1]!.sql, /update conversations/);
  assert.equal(calls[1]!.values?.[0], conversation_id);
  assert.equal(calls[1]!.values?.[2], received_at);

  assert.match(calls[2]!.sql, /status = 'replied'/);
  assert.equal(calls[2]!.values?.[0], outbound_message_id);
  assert.equal(calls[2]!.values?.[4], "email");

  await projectReplyLifecycleEvent(
    pool,
    event("reply.classified", {
      conversation_id,
      message_id: inbound_message_id,
      intent: "unsubscribe",
      confidence: 0.99,
      reason: "explicit opt-out",
      received_at,
    }),
  );
  assert.match(calls[3]!.sql, /intent_class/);
  assert.equal(calls[3]!.values?.[0], inbound_message_id);
  assert.equal(calls[3]!.values?.[2], "unsubscribe");
  assert.equal(calls[3]!.values?.[3], 0.99);
  assert.equal(
    JSON.parse(String(calls[3]!.values?.[4])).intent_reason,
    "explicit opt-out",
  );

  assert.match(calls[4]!.sql, /closed_negative/);
  assert.equal(calls[4]!.values?.[0], conversation_id);
  assert.equal(calls[4]!.values?.[2], received_at);
});
