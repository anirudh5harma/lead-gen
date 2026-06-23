import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { createPostgresOwnedDomainEmailChannel } from "../core/channels/email/postgres.ts";

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
      async send() {
        return { external_id: "outlook-1" };
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

  assert.equal(result.status, "sent");
  const selectCall = calls.find(
    (call) =>
      call.sql.includes("from channel_accounts ca") &&
      call.sql.includes("for update of ca"),
  );
  assert.ok(selectCall);
  assert.deepEqual(selectCall?.params, [WORKSPACE_ID, true, false, USER_ID]);
});
