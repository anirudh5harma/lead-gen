import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublishedEvent } from "../core/substrate/events/index.ts";
import {
  CONVERSATION_LIFECYCLE_PROJECTION,
  createConversationLifecycleProjection,
  projectConversationLifecycleEvent,
} from "../core/primitives/conversation-lifecycle.ts";

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

function event(payload: Record<string, unknown>): PublishedEvent {
  return {
    id: randomUUID(),
    workspace_id: randomUUID(),
    event_type: "conversation.opened",
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

test("conversation lifecycle projection declares conversation event set", () => {
  const { pool } = fakePool();
  const projection = createConversationLifecycleProjection(pool);
  assert.equal(projection.name, CONVERSATION_LIFECYCLE_PROJECTION);
  assert.deepEqual(projection.eventTypes, ["conversation.opened"]);
});

test("conversation lifecycle projection materializes opened conversations", async () => {
  const { pool, calls } = fakePool();
  const conversation_id = randomUUID();
  const rep_id = randomUUID();
  const person_id = randomUUID();
  const company_id = randomUUID();
  const signal_id = randomUUID();

  await projectConversationLifecycleEvent(
    pool,
    event({
      conversation_id,
      rep_id,
      counterparty_person_id: person_id,
      counterparty_company_id: company_id,
      origin_signal_id: signal_id,
      topic: "Series A",
      properties: { play_id: randomUUID() },
    }),
  );

  assert.match(calls[0]!.sql, /insert into conversations/);
  assert.equal(calls[0]!.values?.[0], conversation_id);
  assert.equal(calls[0]!.values?.[2], rep_id);
  assert.equal(calls[0]!.values?.[3], person_id);
  assert.equal(calls[0]!.values?.[4], company_id);
  assert.equal(calls[0]!.values?.[5], signal_id);
  assert.equal(calls[0]!.values?.[6], "Series A");
  const properties = JSON.parse(String(calls[0]!.values?.[7])) as {
    conversation_opened_event_id: string;
    play_id: string;
  };
  assert.match(properties.conversation_opened_event_id, /^[0-9a-f-]{36}$/);
  assert.match(properties.play_id, /^[0-9a-f-]{36}$/);
});
