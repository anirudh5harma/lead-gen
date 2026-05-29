import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  bootstrapWorkspace,
  configureRep,
  configureWorkspaceEmailAccount,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import { setupPg } from "./_pg.ts";

test("product bootstrap emits typed events for seeded primitives", async (t) => {
  const fx = await setupPg("product_bootstrap_events");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const boot = await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "evented-bootstrap",
      workspace_name: "Evented Bootstrap",
    });

    const events = await fx.pool.query<{ event_type: string; count: string }>(
      `select event_type, count(*)::text as count
         from events
        where workspace_id = $1
          and event_type in (
            'workspace.created',
            'rep.configured',
            'play.configured',
            'channel.account.configured'
          )
        group by event_type`,
      [boot.workspace_id],
    );
    const counts = new Map(events.rows.map((row) => [row.event_type, row.count]));
    assert.equal(counts.get("workspace.created"), "1");
    assert.equal(counts.get("rep.configured"), "1");
    assert.equal(counts.get("play.configured"), "1");
    assert.equal(counts.get("channel.account.configured"), "1");

    const membership = await fx.pool.query<{ role: string; accepted: boolean }>(
      `select role::text as role, accepted_at is not null as accepted
         from workspace_members
        where workspace_id = $1 and user_id = $2`,
      [boot.workspace_id, userId],
    );
    assert.deepEqual(membership.rows[0], { role: "owner", accepted: true });

    const account = await fx.pool.query<{ id: string; status: string }>(
      `select id, status::text as status
         from channel_accounts
        where workspace_id = $1 and kind = 'email_domain'`,
      [boot.workspace_id],
    );
    assert.equal(account.rows[0].id, boot.channel_account_id);
    assert.equal(account.rows[0].status, "connected");

    await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "evented-bootstrap",
      workspace_name: "Evented Bootstrap",
    });
    const afterRepeat = await fx.pool.query<{ event_type: string; count: string }>(
      `select event_type, count(*)::text as count
         from events
        where workspace_id = $1
          and event_type in (
            'workspace.created',
            'rep.configured',
            'play.configured',
            'channel.account.configured'
          )
        group by event_type`,
      [boot.workspace_id],
    );
    const repeatCounts = new Map(
      afterRepeat.rows.map((row) => [row.event_type, row.count]),
    );
    assert.equal(repeatCounts.get("workspace.created"), "1");
    assert.equal(repeatCounts.get("rep.configured"), "1");
    assert.equal(repeatCounts.get("play.configured"), "1");
    assert.equal(repeatCounts.get("channel.account.configured"), "1");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("product configuration events append changed user state but dedupe exact retries", async (t) => {
  const fx = await setupPg("product_configuration_event_updates");
  if (!fx) return t.skip("DATABASE_URL not set");

  setPool(fx.pool);
  try {
    const userId = randomUUID();
    const boot = await bootstrapWorkspace(fx.pool, userId, {
      workspace_slug: "configuration-events",
      workspace_name: "Configuration Events",
    });
    const session = { workspace_id: boot.workspace_id, user_id: userId };

    await configureRep(
      {
        name: "Maya",
        voice: "Crisp founder-to-founder.",
        daily_cap: 12,
        approval: "approve_first",
      },
      session,
    );
    await configureRep(
      {
        name: "Maya",
        voice: "Warmer but still concise.",
        daily_cap: 12,
        approval: "approve_first",
      },
      session,
    );
    await configureRep(
      {
        name: "Maya",
        voice: "Warmer but still concise.",
        daily_cap: 12,
        approval: "approve_first",
      },
      session,
    );

    const rep = await fx.pool.query<{ voice: string; user_events: string }>(
      `select persona->>'voice' as voice,
              (select count(*)::text
                 from events
                where workspace_id = $1
                  and event_type = 'rep.configured'
                  and source = 'user') as user_events
         from reps
        where workspace_id = $1 and id = $2`,
      [boot.workspace_id, boot.rep_id],
    );
    assert.equal(rep.rows[0].voice, "Warmer but still concise.");
    assert.equal(rep.rows[0].user_events, "2");

    await configureWorkspaceEmailAccount(
      { display_name: "maya@go.bombsell.example", daily_cap: 10 },
      session,
    );
    await configureWorkspaceEmailAccount(
      { display_name: "maya@try.bombsell.example", daily_cap: 10 },
      session,
    );
    await configureWorkspaceEmailAccount(
      { display_name: "maya@try.bombsell.example", daily_cap: 10 },
      session,
    );

    const account = await fx.pool.query<{
      display_name: string;
      user_events: string;
    }>(
      `select display_name,
              (select count(*)::text
                 from events
                where workspace_id = $1
                  and event_type = 'channel.account.configured'
                  and source = 'user') as user_events
         from channel_accounts
        where workspace_id = $1 and id = $2`,
      [boot.workspace_id, boot.channel_account_id],
    );
    assert.equal(account.rows[0].display_name, "maya@try.bombsell.example");
    assert.equal(account.rows[0].user_events, "2");
  } finally {
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});
