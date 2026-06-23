import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createPostgresLinkedInChannel } from "../core/channels/linkedin/postgres.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

test("postgres linkedin channel scopes account loading to the resolved owner", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const channel = createPostgresLinkedInChannel({
    pool: {
      async query(sql: string, params?: unknown[]) {
        calls.push({ sql, params });
        if (sql.includes("from events e")) {
          return { rows: [], rowCount: 0 };
        }
        return {
          rows: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              display_name: "Founder LinkedIn",
              kind: "linkedin_session",
              status: "connected",
              daily_cap: 10,
              daily_used: 0,
            },
          ],
          rowCount: 1,
        };
      },
    } as never,
    transport: {
      async send() {
        return { external_id: "linkedin-1" };
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
      counterparty_linkedin_url: "https://www.linkedin.com/in/owner",
    },
    {
      message_id: randomUUID(),
      channel: "linkedin_dm",
      body: "Hello",
      eval_passed: true,
    },
    {
      workspace_id: WORKSPACE_ID,
      bus: createInMemoryEventBus(),
    },
  );

  assert.equal(result.status, "sent");
  const selectCall = calls.find((call) =>
    call.sql.includes("from channel_accounts"),
  );
  assert.ok(selectCall);
  assert.deepEqual(selectCall?.params, [WORKSPACE_ID, USER_ID]);
});
