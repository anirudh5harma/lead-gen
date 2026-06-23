import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventInput } from "../core/substrate/events/index.ts";
import {
  LINKEDIN_PROVIDER_AUTHORIZATION_PROJECTION,
  createLinkedInProviderAuthorizationProjection,
  projectLinkedInProviderAuthorization,
} from "../core/channels/linkedin/provider-ingress.ts";

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

function fakeBus() {
  const published: EventInput[] = [];
  return {
    published,
    bus: {
      async publish(event: EventInput) {
        published.push(event);
        return {
          id: randomUUID(),
          occurred_at: "2026-06-02T10:00:00.000Z",
          schema_version: 1,
          correlation_id: null,
          causation_id: null,
          producer_ref: null,
          idempotency_key: null,
          ...event,
        };
      },
    },
  };
}

test("LinkedIn provider authorization projection declares the auth ingress event", () => {
  const { pool } = fakePool();
  const { bus } = fakeBus();
  const projection = createLinkedInProviderAuthorizationProjection({
    pool,
    bus: bus as never,
  });

  assert.equal(projection.name, LINKEDIN_PROVIDER_AUTHORIZATION_PROJECTION);
  assert.deepEqual(projection.eventTypes, ["linkedin.account.authorization.received"]);
});

test("LinkedIn provider authorization creates account and emits connected lifecycle", async () => {
  const { pool, calls } = fakePool();
  const { bus, published } = fakeBus();
  const workspace_id = randomUUID();
  const channel_account_id = randomUUID();
  const event_id = randomUUID();
  const user_id = randomUUID();

  await projectLinkedInProviderAuthorization(pool, bus as never, {
    id: event_id,
    workspace_id,
    event_type: "linkedin.account.authorization.received",
    schema_version: 1,
    correlation_id: null,
    causation_id: null,
    source: "user",
    producer_ref: "user:test",
    idempotency_key: null,
    occurred_at: "2026-06-02T10:00:00.000Z",
    payload: {
      channel_account_id,
      user_id,
      kind: "linkedin_oauth",
      display_name: "Founder LinkedIn",
      provider_account_id: "provider-acct-1",
      profile_url: "https://www.linkedin.com/in/founder",
      daily_cap: 15,
      properties: { provider_workspace: "workspace-1" },
    },
  });

  assert.match(calls[0]!.sql, /insert into channel_accounts/);
  assert.equal(calls[0]!.values?.[0], channel_account_id);
  assert.equal(calls[0]!.values?.[1], workspace_id);
  assert.equal(calls[0]!.values?.[2], user_id);
  assert.equal(calls[0]!.values?.[3], "linkedin_oauth");
  assert.equal(calls[0]!.values?.[4], "Founder LinkedIn");
  assert.equal(calls[0]!.values?.[5], 15);
  assert.deepEqual(JSON.parse(String(calls[0]!.values?.[6])), {
    provider_workspace: "workspace-1",
    provider: "linkedin",
    provider_account_id: "provider-acct-1",
    profile_url: "https://www.linkedin.com/in/founder",
    authorized_event_id: event_id,
  });

  assert.equal(published.length, 1);
  assert.equal(published[0]!.event_type, "channel.account.connected");
  assert.equal(published[0]!.causation_id, event_id);
  assert.deepEqual(published[0]!.payload, {
    channel_account_id,
    kind: "linkedin_oauth",
  });
});

test("LinkedIn provider authorization rejects account conflicts", async () => {
  const { pool } = fakePool(0);
  const { bus } = fakeBus();

  await assert.rejects(
    projectLinkedInProviderAuthorization(pool, bus as never, {
      id: randomUUID(),
      workspace_id: randomUUID(),
      event_type: "linkedin.account.authorization.received",
      schema_version: 1,
      correlation_id: null,
      causation_id: null,
      source: "user",
      producer_ref: "user:test",
      idempotency_key: null,
      occurred_at: "2026-06-02T10:00:00.000Z",
      payload: {
        channel_account_id: randomUUID(),
        kind: "linkedin_oauth",
        display_name: "Founder LinkedIn",
        provider_account_id: "provider-acct-1",
      },
    }),
    /rejected account/,
  );
});
