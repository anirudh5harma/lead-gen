import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createPostgresOwnedDomainEmailChannel } from "../core/channels/email/postgres.ts";
import { OutlookSendError } from "../core/channels/email/adapters/outlook.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

test("postgres email channel scopes Outlook reservation to the resolved owner", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql === "begin" || sql === "commit") {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from messages m") && sql.includes("for update of m")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from graph_persons") && sql.includes("for update")) {
        return { rows: [{ id: randomUUID() }], rowCount: 1 };
      }
      if (sql.includes("select max(m.created_at) as last_contacted_at")) {
        return { rows: [{ last_contacted_at: null }], rowCount: 1 };
      }
      if (sql.includes("from events e")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from channel_accounts ca") && sql.includes("for update of ca")) {
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              display_name: "owner@example.com",
              kind: "oauth_outlook",
              status: "connected",
              daily_cap: 5,
              daily_used: 0,
              daily_window_start: null,
              domain: null,
              warmup_state: null,
              current_daily_cap: null,
              bounce_rate_24h: null,
              complaint_rate_24h: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("update channel_accounts")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    connect: async () => client,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
  const channel = createPostgresOwnedDomainEmailChannel({
    pool: pool as never,
    outlook: {
      async getAccessToken() { return "token"; },
      async confirmSent() { return null; },
      async send() {
        return { status: "accepted" as const, request_id: "outlook-1" };
      },
      async getAccessToken() { return "token"; },
      async confirmSent() { return "<confirmed@example.com>"; },
    },
    resolveConnectedAccountUserId: async () => USER_ID,
  });

  const result = await channel.send(
    {
      id: randomUUID(),
      workspace_id: WORKSPACE_ID,
      rep_id: randomUUID(),
      counterparty_person_id: randomUUID(),
      counterparty_email: "buyer@example.com",
    },
    {
      message_id: randomUUID(),
      channel: "email",
      subject: "Hello",
      body: "Hi there",
      eval_passed: true,
    },
    {
      workspace_id: WORKSPACE_ID,
      bus: createInMemoryEventBus(),
    },
  );

  assert.equal(result.status, "queued");
  const selectCall = calls.find(
    (call) =>
      call.sql.includes("from channel_accounts ca") &&
      call.sql.includes("for update of ca"),
  );
  assert.ok(selectCall);
  assert.deepEqual(selectCall?.params, [WORKSPACE_ID, true, false, USER_ID]);
  assert.match(selectCall?.sql ?? "", /row_number\(\) over/);
  assert.match(selectCall?.sql ?? "", /outlook:' \|\| coalesce|outlook:'\s*\|\|\s*coalesce/);
  assert.match(selectCall?.sql ?? "", /rc\.account_rank = 1/);
});

test("postgres email channel defers Outlook invalid recipients and releases cap", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql === "begin" || sql === "commit") return { rows: [], rowCount: 0 };
      if (sql.includes("from messages m") && sql.includes("for update of m")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("from graph_persons") && sql.includes("for update")) {
        return { rows: [{ id: randomUUID() }], rowCount: 1 };
      }
      if (sql.includes("select max(m.created_at) as last_contacted_at")) {
        return { rows: [{ last_contacted_at: null }], rowCount: 1 };
      }
      if (sql.includes("from channel_accounts ca") && sql.includes("for update of ca")) {
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              display_name: "owner@example.com",
              kind: "oauth_outlook",
              status: "connected",
              daily_cap: 5,
              daily_used: 0,
              daily_window_start: null,
              domain: null,
              warmup_state: null,
              current_daily_cap: null,
              bounce_rate_24h: null,
              complaint_rate_24h: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("update channel_accounts")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = {
    connect: async () => client,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  };
  const bus = createInMemoryEventBus();
  const channel = createPostgresOwnedDomainEmailChannel({
    pool: pool as never,
    outlook: {
      async send() {
        throw new OutlookSendError("Outlook sendMail failed (400)", 400, "ErrorInvalidRecipients");
      },
    },
    resolveConnectedAccountUserId: async () => USER_ID,
  });

  const result = await channel.send(
    {
      id: randomUUID(),
      workspace_id: WORKSPACE_ID,
      rep_id: randomUUID(),
      counterparty_person_id: randomUUID(),
      counterparty_email: "{buyer@example.com}",
    },
    {
      message_id: randomUUID(),
      channel: "email",
      subject: "Hello",
      body: "Hi there",
      eval_passed: true,
    },
    {
      workspace_id: WORKSPACE_ID,
      bus,
    },
  );

  assert.equal(result.status, "deferred");
  if (result.status === "deferred") assert.equal(result.defer_reason, "invalid_recipient_email");
  assert.ok(calls.some((call) => call.sql.includes("daily_used = greatest(daily_used - 1, 0)")));
  assert.ok(bus.published.some((event) => event.event_type === "channel.account.errored"));
  assert.ok(bus.published.some((event) => event.event_type === "message.deferred"));
});
