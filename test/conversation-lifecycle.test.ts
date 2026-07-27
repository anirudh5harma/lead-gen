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
import { deterministicConversationId } from "../core/primitives/conversation-identity.ts";

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
  assert.deepEqual(projection.eventTypes, [
    "conversation.opened",
    "conversation.signal.attached",
  ]);
});

test("conversation identity is stable across reps and signals for one relationship", () => {
  const workspace_id = randomUUID();
  const counterparty_person_id = randomUUID();
  const counterparty_company_id = randomUUID();

  const first = deterministicConversationId({
    workspace_id,
    counterparty_person_id,
    counterparty_company_id,
  });
  const second = deterministicConversationId({
    workspace_id,
    counterparty_person_id,
    counterparty_company_id,
  });
  const differentCompany = deterministicConversationId({
    workspace_id,
    counterparty_person_id,
    counterparty_company_id: randomUUID(),
  });

  assert.equal(first, second);
  assert.notEqual(first, differentCompany);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test("conversation lifecycle projection materializes opened conversations", async () => {
  const { pool, calls } = fakePool();
  const conversation_id = randomUUID();
  const rep_id = randomUUID();
  const person_id = randomUUID();
  const company_id = randomUUID();
  const signal_id = randomUUID();

  const opened = event({
      conversation_id,
      rep_id,
      counterparty_person_id: person_id,
      counterparty_company_id: company_id,
      origin_signal_id: signal_id,
      topic: "Series A",
      properties: { play_id: randomUUID() },
    });
  await projectConversationLifecycleEvent(pool, opened);

  const insert = calls.find((call) => /insert into conversations/.test(call.sql));
  assert.ok(insert);
  const existing = calls.find((call) => /from conversations/.test(call.sql));
  assert.ok(existing);
  assert.deepEqual(existing.values, [
    opened.workspace_id,
    conversation_id,
    person_id,
    company_id,
  ]);
  assert.equal(insert.values?.[0], conversation_id);
  assert.equal(insert.values?.[2], rep_id);
  assert.equal(insert.values?.[3], person_id);
  assert.equal(insert.values?.[4], company_id);
  assert.equal(insert.values?.[5], signal_id);
  assert.equal(insert.values?.[6], "Series A");
  const properties = JSON.parse(String(insert.values?.[7])) as {
    conversation_opened_event_id: string;
    requested_conversation_id: string;
    play_id: string;
  };
  assert.match(properties.conversation_opened_event_id, /^[0-9a-f-]{36}$/);
  assert.equal(properties.requested_conversation_id, conversation_id);
  assert.match(properties.play_id, /^[0-9a-f-]{36}$/);
});
