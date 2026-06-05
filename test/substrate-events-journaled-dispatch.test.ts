import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJournaledDispatchEventBus } from "../core/substrate/events/adapters/journaled-dispatch.ts";
import { setupPg } from "./_pg.ts";

test("journaled dispatch bus: appends canonical event and queues NATS dispatch", async (t) => {
  const fx = await setupPg("journaled_dispatch");
  if (!fx) return t.skip("DATABASE_URL not set");

  const workspaceId = randomUUID();
  await fx.pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspaceId, `ws-${workspaceId.slice(0, 8)}`, "dispatch ingress test"],
  );

  const bus = await createJournaledDispatchEventBus({ pool: fx.pool });
  try {
    const signalId = randomUUID();
    const input = {
      workspace_id: workspaceId,
      event_type: "signal.dismissed" as const,
      source: "user" as const,
      idempotency_key: `dismiss:${signalId}`,
      payload: {
        signal_id: signalId,
        reason: "not relevant",
      },
    };

    const first = await bus.publish(input);
    const retry = await bus.publish(input);

    assert.equal(retry.id, first.id);

    const events = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n
         from events
        where workspace_id = $1
          and event_type = 'signal.dismissed'`,
      [workspaceId],
    );
    assert.equal(events.rows[0]?.n, "1");

    const dispatches = await fx.pool.query<{ n: string; status: string }>(
      `select count(*)::text as n, max(status)::text as status
         from event_nats_dispatches
        where event_id = $1`,
      [first.id],
    );
    assert.equal(dispatches.rows[0]?.n, "1");
    assert.equal(dispatches.rows[0]?.status, "pending");
  } finally {
    await bus.close();
    await fx.close();
  }
});
