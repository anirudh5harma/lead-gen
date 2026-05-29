import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublishedEvent } from "../core/substrate/events/index.ts";
import {
  OUTCOME_LIFECYCLE_PROJECTION,
  createOutcomeLifecycleProjection,
  projectOutcomeLifecycleEvent,
} from "../core/primitives/outcome-lifecycle.ts";

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

test("outcome lifecycle projection declares outcome event set", () => {
  const { pool } = fakePool();
  const projection = createOutcomeLifecycleProjection(pool);
  assert.equal(projection.name, OUTCOME_LIFECYCLE_PROJECTION);
  assert.deepEqual(projection.eventTypes, ["outcome.recorded"]);
});

test("outcome lifecycle projection materializes recorded outcomes", async () => {
  const { pool, calls } = fakePool();
  const outcome_id = randomUUID();
  const conversation_id = randomUUID();
  const attributed_message_id = randomUUID();
  const attributed_rep_id = randomUUID();
  const occurred_at = new Date().toISOString();

  await projectOutcomeLifecycleEvent(
    pool,
    event("outcome.recorded", {
      outcome_id,
      kind: "positive_reply",
      score: 1,
      conversation_id,
      attributed_message_id,
      attributed_signal_id: null,
      attributed_play_id: null,
      attributed_play_run_id: null,
      attributed_rep_id,
      properties: { reply_message_id: randomUUID() },
      provenance: { ingress_event_id: randomUUID() },
      occurred_at,
    }),
  );

  assert.match(calls[0]!.sql, /insert into outcomes/);
  assert.equal(calls[0]!.values?.[0], outcome_id);
  assert.equal(calls[0]!.values?.[2], "positive_reply");
  assert.equal(calls[0]!.values?.[4], conversation_id);
  assert.equal(calls[0]!.values?.[5], attributed_message_id);
  assert.equal(calls[0]!.values?.[9], attributed_rep_id);
  assert.equal(calls[0]!.values?.[14], occurred_at);
  const provenance = JSON.parse(String(calls[0]!.values?.[13])) as {
    ingress_event_id: string;
    outcome_event_id: string;
  };
  assert.match(provenance.ingress_event_id, /^[0-9a-f-]{36}$/);
  assert.match(provenance.outcome_event_id, /^[0-9a-f-]{36}$/);
});
