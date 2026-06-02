import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { PublishedEvent } from "../core/substrate/events/index.ts";
import {
  CHANNEL_ACCOUNT_LIFECYCLE_PROJECTION,
  createChannelAccountLifecycleProjection,
  projectChannelAccountLifecycleEvent,
} from "../core/channels/account-lifecycle.ts";

function fakePool(rowCount = 1) {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [], rowCount };
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
    occurred_at: "2026-06-02T10:00:00.000Z",
  };
}

test("channel account lifecycle projection declares account events", () => {
  const { pool } = fakePool();
  const projection = createChannelAccountLifecycleProjection(pool);
  assert.equal(projection.name, CHANNEL_ACCOUNT_LIFECYCLE_PROJECTION);
  assert.deepEqual(projection.eventTypes, [
    "channel.account.connected",
    "channel.account.errored",
  ]);
});

test("channel account lifecycle projection materializes connected and errored state", async () => {
  const { pool, calls } = fakePool();
  const channel_account_id = randomUUID();

  await projectChannelAccountLifecycleEvent(
    pool,
    event("channel.account.connected", {
      channel_account_id,
      kind: "linkedin_oauth",
      account_display_name: "Maya LinkedIn",
      provider_account_id: "li_acc_123",
      provider_event_id: "evt_connected_1",
    }),
  );
  assert.match(calls[0]!.sql, /last_error = null/);
  assert.equal(calls[0]!.values?.[1], channel_account_id);
  assert.equal(calls[0]!.values?.[2], "linkedin_oauth");
  assert.equal(calls[0]!.values?.[3], "Maya LinkedIn");
  assert.equal(JSON.parse(String(calls[0]!.values?.[4])).provider_account_id, "li_acc_123");
  assert.equal(JSON.parse(String(calls[0]!.values?.[4])).provider_event_id, "evt_connected_1");
  assert.match(
    JSON.parse(String(calls[0]!.values?.[4])).connected_event_id,
    /^[0-9a-f-]{36}$/,
  );

  await projectChannelAccountLifecycleEvent(
    pool,
    event("channel.account.errored", {
      channel_account_id,
      kind: "linkedin_oauth",
      error: "Provider asked us to wait",
      status: "rate_limited",
      account_display_name: "Maya LinkedIn",
      provider_account_id: "li_acc_123",
      provider_event_id: "evt_limit_1",
      provider_incident_id: "inc_123",
      retry_after: "2026-06-02T11:00:00.000Z",
    }),
  );
  assert.match(calls[1]!.sql, /channel_account_status/);
  assert.equal(calls[1]!.values?.[1], channel_account_id);
  assert.equal(calls[1]!.values?.[2], "linkedin_oauth");
  assert.equal(calls[1]!.values?.[3], "rate_limited");
  assert.equal(calls[1]!.values?.[4], "Maya LinkedIn");
  assert.deepEqual(JSON.parse(String(calls[1]!.values?.[5])), {
    message: "Provider asked us to wait",
    at: "2026-06-02T10:00:00.000Z",
    provider_account_id: "li_acc_123",
    provider_event_id: "evt_limit_1",
    provider_incident_id: "inc_123",
    retry_after: "2026-06-02T11:00:00.000Z",
  });
  const properties = JSON.parse(String(calls[1]!.values?.[6]));
  assert.match(properties.errored_event_id, /^[0-9a-f-]{36}$/);
  assert.equal(properties.provider_incident_id, "inc_123");
});

test("channel account lifecycle projection preserves status for generic errors", async () => {
  const { pool, calls } = fakePool();
  const channel_account_id = randomUUID();

  await projectChannelAccountLifecycleEvent(
    pool,
    event("channel.account.errored", {
      channel_account_id,
      kind: "oauth_outlook",
      error: "Graph subscription was removed",
    }),
  );

  assert.equal(calls[0]!.values?.[3], null);
});

test("channel account lifecycle projection rejects missing accounts", async () => {
  const { pool } = fakePool(0);

  await assert.rejects(
    projectChannelAccountLifecycleEvent(
      pool,
      event("channel.account.errored", {
        channel_account_id: randomUUID(),
        kind: "linkedin_oauth",
        error: "missing",
      }),
    ),
    /rejected account/,
  );
});
