import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import { projectOutlookAuthorization } from "../core/channels/email/projectors.ts";

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

test("Outlook authorization projection persists the connecting user", async () => {
  const { pool, calls } = fakePool();
  const workspaceId = randomUUID();
  const channelAccountId = randomUUID();
  const userId = randomUUID();

  await projectOutlookAuthorization(pool, workspaceId, {
    channel_account_id: channelAccountId,
    user_id: userId,
    display_name: "owner@example.com",
    daily_cap: 25,
    encrypted_credentials: {
      encrypted: true,
      version: 1,
      algorithm: "aes-256-gcm",
      iv: "iv",
      tag: "tag",
      ciphertext: "ciphertext",
    },
    ms_user_id: "ms-user-1",
    mailbox_email: "owner@example.com",
  });

  assert.match(calls[0]!.sql, /insert into channel_accounts/);
  assert.equal(calls[0]!.values?.[0], channelAccountId);
  assert.equal(calls[0]!.values?.[1], workspaceId);
  assert.equal(calls[0]!.values?.[2], userId);
  assert.equal(calls[0]!.values?.[3], "owner@example.com");
});
