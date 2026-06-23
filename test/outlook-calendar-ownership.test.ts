import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { getOutlookCalendarAvailability } from "../core/channels/email/outlook-calendar.ts";

function fakePool() {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("update channel_accounts")) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{ id: "acct-user", display_name: "owner@example.com" }],
        rowCount: 1,
      };
    },
  } as unknown as Pool;
  return { pool, calls };
}

test("Outlook calendar availability only reads the caller's connected mailbox", async () => {
  const { pool, calls } = fakePool();
  const result = await getOutlookCalendarAvailability({
    pool,
    accessTokens: {
      async getAccessToken(channelAccountId) {
        assert.equal(channelAccountId, "acct-user");
        return "token";
      },
    },
    workspace_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    fetchImpl: async () => new Response(null, { status: 403 }),
  });

  assert.equal(result.channel_account_id, "acct-user");
  assert.equal(result.account_display_name, "owner@example.com");
  assert.equal(result.reason, "calendar_permission_missing");
  const selectCall = calls.find((call) => call.sql.includes("select id, display_name"));
  assert.deepEqual(selectCall?.values, [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ]);
});
