import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readEvalState } from "../core/channels/email/eval-gate.ts";
import { createJournaledNatsEventBus } from "../core/substrate/events/adapters/journaled-nats.ts";
import { appendPostgresEvent } from "../core/substrate/events/adapters/postgres.ts";
import { createRuntimeEventBus } from "../core/substrate/events/runtime.ts";
import { setupPg, until } from "./_pg.ts";

test("runtime event bus: production rejects missing NATS rather than falling back to Postgres", async () => {
  await assert.rejects(
    createRuntimeEventBus({ env: { NODE_ENV: "production" } }),
    /NATS_URL is required/,
  );
});

test("runtime event bus: production NATS publication journals events used by the eval gate", async (t) => {
  const natsUrl = process.env.NATS_URL;
  if (!natsUrl) return t.skip("NATS_URL not set");
  const fx = await setupPg("runtime_nats_journal");
  if (!fx) return t.skip("DATABASE_URL not set");

  const workspaceId = randomUUID();
  await fx.pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspaceId, `ws-${workspaceId.slice(0, 8)}`, "journal test"],
  );

  const bus = await createRuntimeEventBus({
    env: { NODE_ENV: "production", NATS_URL: natsUrl },
    pool: fx.pool,
  });
  try {
    const messageId = randomUUID();
    const seen: string[] = [];
    await bus.subscribe("draft.judged", (event) => seen.push(event.id));

    const input = {
      workspace_id: workspaceId,
      event_type: "draft.judged" as const,
      source: "agent" as const,
      idempotency_key: `eval:${messageId}`,
      payload: {
        message_id: messageId,
        eval_score: 0.93,
        passed: true,
      },
    };
    const first = await bus.publish(input);
    const retry = await bus.publish(input);

    assert.equal(retry.id, first.id);
    assert.equal(await readEvalState(fx.pool, workspaceId, messageId), "passed");
    await until(() => seen.includes(first.id));

    const result = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n
         from events
        where workspace_id = $1
          and event_type = 'draft.judged'`,
      [workspaceId],
    );
    assert.equal(result.rows[0].n, "1");
    const dispatch = await fx.pool.query<{ status: string }>(
      `select status from event_nats_dispatches where event_id = $1`,
      [first.id],
    );
    assert.equal(dispatch.rows[0]?.status, "delivered");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("journaled NATS bus: redrive delivers a pending canonical event", async (t) => {
  const natsUrl = process.env.NATS_URL;
  if (!natsUrl) return t.skip("NATS_URL not set");
  const fx = await setupPg("runtime_nats_redrive");
  if (!fx) return t.skip("DATABASE_URL not set");

  const workspaceId = randomUUID();
  await fx.pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspaceId, `ws-${workspaceId.slice(0, 8)}`, "redrive test"],
  );
  const bus = await createJournaledNatsEventBus({
    pool: fx.pool,
    servers: natsUrl,
    streamPrefix: `redrive_${Date.now().toString(36)}`,
  });
  try {
    const canonical = await appendPostgresEvent(fx.pool, {
      workspace_id: workspaceId,
      event_type: "signal.dismissed",
      source: "system",
      payload: { signal_id: randomUUID(), reason: "pending-dispatch" },
    });
    await fx.pool.query(
      `insert into event_nats_dispatches (event_id, workspace_id)
       values ($1, $2)`,
      [canonical.id, workspaceId],
    );
    const seen: string[] = [];
    await bus.subscribeScoped(workspaceId, "signal.dismissed", (event) => {
      seen.push(event.id);
    });

    const result = await bus.redrivePending();
    assert.deepEqual(result, { attempted: 1, delivered: 1, failed: 0, dead_lettered: 0 });
    await until(() => seen.includes(canonical.id));

    const dispatch = await fx.pool.query<{ status: string; attempts: number }>(
      `select status, attempts from event_nats_dispatches where event_id = $1`,
      [canonical.id],
    );
    assert.equal(dispatch.rows[0]?.status, "delivered");
    assert.equal(dispatch.rows[0]?.attempts, 1);
  } finally {
    await bus.close();
    await fx.close();
  }
});
