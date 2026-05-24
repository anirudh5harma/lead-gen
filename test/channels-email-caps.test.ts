import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  checkDailyCap,
  checkFrequencyCap,
  refundSend,
  reserveSend,
} from "../core/channels/email/caps.ts";

async function seedAccount(
  pool: Pool,
  daily_cap: number | null,
  kind: "email_domain" | "oauth_outlook" = "email_domain",
): Promise<{ workspace_id: string; channel_account_id: string }> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  const channel_account_id = randomUUID();
  await pool.query(
    `insert into channel_accounts (id, workspace_id, kind, display_name, status, daily_cap)
     values ($1, $2, $3, $4, 'connected', $5)`,
    [channel_account_id, workspace_id, kind, "x", daily_cap],
  );
  return { workspace_id, channel_account_id };
}

test("daily cap: reserveSend honours the cap; refundSend rolls back", async (t) => {
  const fx = await setupPg("cap_basic");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { channel_account_id } = await seedAccount(fx.pool, 2);
    assert.equal(await reserveSend(fx.pool, channel_account_id), true);
    assert.equal(await reserveSend(fx.pool, channel_account_id), true);
    // At the cap.
    assert.equal(await reserveSend(fx.pool, channel_account_id), false);

    await refundSend(fx.pool, channel_account_id);
    assert.equal(await reserveSend(fx.pool, channel_account_id), true);
  } finally {
    await fx.close();
  }
});

test("daily cap: 24h window rolls over via checkDailyCap", async (t) => {
  const fx = await setupPg("cap_rollover");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { channel_account_id } = await seedAccount(fx.pool, 1);
    await reserveSend(fx.pool, channel_account_id);
    // Pretend the window opened > 24h ago.
    await fx.pool.query(
      `update channel_accounts
          set daily_window_start = now() - interval '25 hours'
        where id = $1`,
      [channel_account_id],
    );
    const status = await checkDailyCap(fx.pool, channel_account_id);
    assert.equal(status.daily_used, 0);
    assert.equal(status.allowed, true);
    assert.equal(await reserveSend(fx.pool, channel_account_id), true);
  } finally {
    await fx.close();
  }
});

test("daily cap: null cap is treated as unlimited", async (t) => {
  const fx = await setupPg("cap_null");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { channel_account_id } = await seedAccount(fx.pool, null);
    for (let i = 0; i < 5; i++) {
      assert.equal(await reserveSend(fx.pool, channel_account_id), true);
    }
    const status = await checkDailyCap(fx.pool, channel_account_id);
    assert.equal(status.allowed, true);
  } finally {
    await fx.close();
  }
});

test("daily cap: disconnected account cannot reserve", async (t) => {
  const fx = await setupPg("cap_disc");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { channel_account_id } = await seedAccount(fx.pool, 10);
    await fx.pool.query(
      `update channel_accounts set status = 'needs_reauth' where id = $1`,
      [channel_account_id],
    );
    assert.equal(await reserveSend(fx.pool, channel_account_id), false);
  } finally {
    await fx.close();
  }
});

test("frequency cap: per-recipient count across the workspace", async (t) => {
  const fx = await setupPg("freq");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { workspace_id, channel_account_id } = await seedAccount(fx.pool, 100);
    // Seed a person + rep + conversation + recent outbound messages.
    const person_id = randomUUID();
    await fx.pool.query(
      `insert into graph_persons (id, workspace_id, full_name, emails)
       values ($1, $2, 'A', array['a@example.com']::citext[])`,
      [person_id, workspace_id],
    );
    const rep_id = randomUUID();
    await fx.pool.query(
      `insert into reps (id, workspace_id, name, role, status, persona)
       values ($1, $2, 'R', 'sdr', 'active', '{}'::jsonb)`,
      [rep_id, workspace_id],
    );
    const conv_id = randomUUID();
    await fx.pool.query(
      `insert into conversations (id, workspace_id, rep_id, counterparty_person_id)
       values ($1, $2, $3, $4)`,
      [conv_id, workspace_id, rep_id, person_id],
    );
    for (let i = 0; i < 2; i++) {
      await fx.pool.query(
        `insert into messages (id, workspace_id, conversation_id, channel, direction, status, sent_at, channel_account_id)
         values ($1, $2, $3, 'email', 'outbound', 'sent', now() - interval '1 hour', $4)`,
        [randomUUID(), workspace_id, conv_id, channel_account_id],
      );
    }

    const cap0 = await checkFrequencyCap(fx.pool, workspace_id, person_id, {
      max_in_window: 1,
    });
    assert.equal(cap0.allowed, false);
    assert.equal(cap0.count, 2);

    const capHigh = await checkFrequencyCap(fx.pool, workspace_id, person_id, {
      max_in_window: 5,
    });
    assert.equal(capHigh.allowed, true);

    // Old messages don't count.
    await fx.pool.query(
      `update messages set sent_at = now() - interval '48 hours' where conversation_id = $1`,
      [conv_id],
    );
    const capOld = await checkFrequencyCap(fx.pool, workspace_id, person_id, {
      max_in_window: 1,
      window_hours: 24,
    });
    assert.equal(capOld.allowed, true);
    assert.equal(capOld.count, 0);
  } finally {
    await fx.close();
  }
});
