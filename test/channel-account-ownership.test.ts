import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { repairUserConnectedChannelAccountOwners } from "../core/channels/account-ownership.ts";
import { setupPg } from "./_pg.ts";

test("channel account ownership repair backfills missing owner from auth events", async (t) => {
  const fx = await setupPg("channel_account_owner");
  if (!fx) return t.skip("DATABASE_URL not set");
  const workspaceId = randomUUID();
  const channelAccountId = randomUUID();
  const userId = randomUUID();

  try {
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, 'ws')`,
      [workspaceId, `ws-${workspaceId.slice(0, 8)}`],
    );
    await fx.pool.query(
      `insert into channel_accounts (id, workspace_id, kind, display_name, status)
       values ($1, $2, 'oauth_outlook', 'owner@example.com', 'connected')`,
      [channelAccountId, workspaceId],
    );
    await fx.pool.query(
      `insert into events (
         workspace_id, event_type, schema_version, source, producer_ref, payload
       ) values (
         $1, 'email.outlook.authorization.received', 1, 'user', $2, $3::jsonb
       )`,
      [
        workspaceId,
        `user:${userId}`,
        JSON.stringify({
          channel_account_id: channelAccountId,
          display_name: "owner@example.com",
        }),
      ],
    );

    const repaired = await repairUserConnectedChannelAccountOwners(
      fx.pool,
      workspaceId,
    );
    assert.equal(repaired, 1);

    const { rows } = await fx.pool.query<{ user_id: string | null }>(
      `select user_id::text as user_id
         from channel_accounts
        where id = $1`,
      [channelAccountId],
    );
    assert.equal(rows[0]?.user_id, userId);
  } finally {
    await fx.close();
  }
});
