import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  appendPostgresEvent,
  listDeadLetteredDispatches,
  redriveDeadLetteredDispatch,
} from "../core/substrate/events/index.ts";

/**
 * The journaled NATS bus is exercised end-to-end against a real broker in
 * substrate-events-runtime.test.ts. Here we focus on the dead-letter
 * state machine in isolation by driving the SQL directly the way the
 * production bus does. That keeps the test deterministic and independent
 * of a NATS broker being available.
 */

async function seedWorkspaceAndEvent(pool: Pool): Promise<{
  workspace_id: string;
  event_id: string;
}> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "dlq test"],
  );
  const canonical = await appendPostgresEvent(pool, {
    workspace_id,
    event_type: "signal.dismissed",
    source: "system",
    payload: { signal_id: randomUUID(), reason: "test" },
  });
  await pool.query(
    `insert into event_nats_dispatches (event_id, workspace_id)
     values ($1, $2)`,
    [canonical.id, workspace_id],
  );
  return { workspace_id, event_id: canonical.id };
}

/** Replays the journaled-nats failure path: bump attempts; flip to
 *  dead_lettered once attempts hit the ceiling. */
async function simulateFailedAttempt(
  pool: Pool,
  event_id: string,
  maxAttempts: number,
  errorMessage = "broker unreachable",
): Promise<void> {
  await pool.query(
    `update event_nats_dispatches
        set attempts        = attempts + 1,
            last_error      = $2,
            status          = case
                                when status = 'pending'
                                 and attempts + 1 >= $3
                                then 'dead_lettered'
                                else status
                              end,
            dead_lettered_at = case
                                 when status = 'pending'
                                  and attempts + 1 >= $3
                                 then now()
                                 else dead_lettered_at
                               end,
            next_attempt_at = case
                                when status = 'pending'
                                 and attempts + 1 < $3
                                then now() + interval '5 seconds'
                                else next_attempt_at
                              end,
            updated_at      = now()
      where event_id = $1
        and status in ('pending')`,
    [event_id, errorMessage, maxAttempts],
  );
}

test("dispatch DLQ: pending → dead_lettered after maxAttempts failures", async (t) => {
  const fx = await setupPg("dlq_flip");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { event_id } = await seedWorkspaceAndEvent(fx.pool);

    // Three failures with maxAttempts=3 → row flips on the third attempt.
    await simulateFailedAttempt(fx.pool, event_id, 3);
    let row = await fx.pool.query<{ status: string; attempts: number }>(
      `select status, attempts from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(row.rows[0].status, "pending");
    assert.equal(row.rows[0].attempts, 1);

    await simulateFailedAttempt(fx.pool, event_id, 3);
    row = await fx.pool.query<{ status: string; attempts: number }>(
      `select status, attempts from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(row.rows[0].status, "pending");
    assert.equal(row.rows[0].attempts, 2);

    await simulateFailedAttempt(fx.pool, event_id, 3);
    row = await fx.pool.query<{
      status: string;
      attempts: number;
      dead_lettered_at: Date | null;
    }>(
      `select status, attempts, dead_lettered_at from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(row.rows[0].status, "dead_lettered");
    assert.equal(row.rows[0].attempts, 3);
    assert.ok(row.rows[0].dead_lettered_at);
  } finally {
    await fx.close();
  }
});

test("dispatch DLQ: further failures on a dead-lettered row are no-ops", async (t) => {
  const fx = await setupPg("dlq_terminal");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { event_id } = await seedWorkspaceAndEvent(fx.pool);
    await simulateFailedAttempt(fx.pool, event_id, 1);
    let row = await fx.pool.query<{ attempts: number; status: string }>(
      `select attempts, status from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(row.rows[0].status, "dead_lettered");
    assert.equal(row.rows[0].attempts, 1);

    // The failure-handler clause WHERE status='pending' means a second
    // failure attempt on a dead-lettered row leaves it alone.
    await simulateFailedAttempt(fx.pool, event_id, 1);
    row = await fx.pool.query<{ attempts: number; status: string }>(
      `select attempts, status from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(row.rows[0].attempts, 1);
    assert.equal(row.rows[0].status, "dead_lettered");
  } finally {
    await fx.close();
  }
});

test("listDeadLetteredDispatches: returns rows for the requested workspace, newest first", async (t) => {
  const fx = await setupPg("dlq_list");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const first = await seedWorkspaceAndEvent(fx.pool);
    const second = await seedWorkspaceAndEvent(fx.pool); // different workspace
    await simulateFailedAttempt(fx.pool, first.event_id, 1, "kaboom");

    const myDead = await listDeadLetteredDispatches(fx.pool, first.workspace_id);
    assert.equal(myDead.length, 1);
    assert.equal(myDead[0].event_id, first.event_id);
    assert.equal(myDead[0].last_error, "kaboom");
    assert.equal(myDead[0].attempts, 1);

    const otherDead = await listDeadLetteredDispatches(
      fx.pool,
      second.workspace_id,
    );
    assert.equal(otherDead.length, 0);
  } finally {
    await fx.close();
  }
});

test("dispatch DLQ: operator redrive (route-style flip) resets to pending and clears dead_lettered_at", async (t) => {
  const fx = await setupPg("dlq_redrive");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { event_id } = await seedWorkspaceAndEvent(fx.pool);
    await simulateFailedAttempt(fx.pool, event_id, 1);
    const before = await fx.pool.query<{ status: string }>(
      `select status from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(before.rows[0].status, "dead_lettered");

    const flipped = await redriveDeadLetteredDispatch(fx.pool, event_id);
    assert.equal(flipped, true);

    const after = await fx.pool.query<{
      status: string;
      dead_lettered_at: Date | null;
    }>(
      `select status, dead_lettered_at from event_nats_dispatches where event_id = $1`,
      [event_id],
    );
    assert.equal(after.rows[0].status, "pending");
    assert.equal(after.rows[0].dead_lettered_at, null);
  } finally {
    await fx.close();
  }
});

test("dispatch DLQ: operator redrive is scoped to the requested workspace", async (t) => {
  const fx = await setupPg("dlq_redrive_scope");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const own = await seedWorkspaceAndEvent(fx.pool);
    const other = await seedWorkspaceAndEvent(fx.pool);
    await simulateFailedAttempt(fx.pool, own.event_id, 1);
    await simulateFailedAttempt(fx.pool, other.event_id, 1);

    const blocked = await redriveDeadLetteredDispatch(fx.pool, other.event_id, {
      workspace_id: own.workspace_id,
    });
    assert.equal(blocked, false);

    const ownRedriven = await redriveDeadLetteredDispatch(fx.pool, own.event_id, {
      workspace_id: own.workspace_id,
    });
    assert.equal(ownRedriven, true);

    const rows = await fx.pool.query<{ event_id: string; status: string }>(
      `select event_id, status from event_nats_dispatches
        where event_id = any($1::uuid[])
        order by event_id`,
      [[own.event_id, other.event_id]],
    );
    const statuses = new Map(rows.rows.map((row) => [row.event_id, row.status]));
    assert.equal(statuses.get(own.event_id), "pending");
    assert.equal(statuses.get(other.event_id), "dead_lettered");
  } finally {
    await fx.close();
  }
});
