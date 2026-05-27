import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPostgresEventBus } from "../core/substrate/events/index.ts";
import {
  createPostgresRestateEventSignalStore,
  deliverEventToRestateWaits,
} from "../core/substrate/workflows/adapters/restate-signal-bridge.ts";
import { setupPg } from "./_pg.ts";

test("Restate event signal bridge delivers typed bus events to waiting workflows", async (t) => {
  const fx = await setupPg("restate_signal_bridge");
  if (!fx) return t.skip("DATABASE_URL not set");

  try {
    const workspaceId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspaceId, `bridge-${workspaceId}`, "Bridge test"],
    );

    const store = createPostgresRestateEventSignalStore(fx.pool);
    await store.registerWait({
      id: "wait-1",
      workspace_id: workspaceId,
      workflow_name: "waiter",
      workflow_key: "key/1",
      run_id: "invocation-1",
      event_type: "signal.matched",
      promise_name: "event:signal.matched:0",
    });

    const bus = await createPostgresEventBus({ pool: fx.pool });
    t.after(async () => {
      await bus.close();
    });
    const event = await bus.publish({
      workspace_id: workspaceId,
      event_type: "signal.matched",
      source: "system",
      producer_ref: "test",
      payload: {
        signal_id: randomUUID(),
        match_score: 0.91,
        icp_segment: "enterprise",
      },
    });

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 202 });
    };

    const delivered = await deliverEventToRestateWaits({
      pool: fx.pool,
      bus,
      ingressUrl: "https://restate.example",
      fetchImpl,
    }, event);

    assert.equal(delivered, 1);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      "https://restate.example/waiter/key%2F1/resolveEventWait/send",
    );
    assert.equal(
      (calls[0].init.headers as Record<string, string>)["idempotency-key"],
      `workflow-event-wait:wait-1:${event.id}`,
    );
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      wait_id: "wait-1",
      promise_name: "event:signal.matched:0",
      event,
    });

    const deliveredRow = await fx.pool.query<{
      status: string;
      matched_event_id: string;
      delivered_payload: unknown;
    }>(
      `select status, matched_event_id, delivered_payload
         from workflow_event_waits
        where id = $1`,
      ["wait-1"],
    );
    assert.equal(deliveredRow.rows[0].status, "delivered");
    assert.equal(deliveredRow.rows[0].matched_event_id, event.id);
    assert.deepEqual(deliveredRow.rows[0].delivered_payload, event.payload);

    await store.consumeWait("wait-1");
    const consumed = await fx.pool.query<{ status: string }>(
      `select status from workflow_event_waits where id = $1`,
      ["wait-1"],
    );
    assert.equal(consumed.rows[0].status, "consumed");
  } finally {
    await fx.close();
  }
});

test("Restate event signal bridge returns failed deliveries to waiting state", async (t) => {
  const fx = await setupPg("restate_signal_retry");
  if (!fx) return t.skip("DATABASE_URL not set");

  try {
    const workspaceId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspaceId, `retry-${workspaceId}`, "Retry test"],
    );

    const store = createPostgresRestateEventSignalStore(fx.pool);
    await store.registerWait({
      id: "wait-retry",
      workspace_id: workspaceId,
      workflow_name: "waiter",
      workflow_key: "key-1",
      run_id: "invocation-1",
      event_type: "signal.matched",
      promise_name: "event:signal.matched:0",
    });

    const bus = await createPostgresEventBus({ pool: fx.pool });
    t.after(async () => {
      await bus.close();
    });
    const event = await bus.publish({
      workspace_id: workspaceId,
      event_type: "signal.matched",
      source: "system",
      producer_ref: "test",
      payload: {
        signal_id: randomUUID(),
        match_score: 0.7,
      },
    });

    await assert.rejects(
      deliverEventToRestateWaits({
        pool: fx.pool,
        bus,
        ingressUrl: "https://restate.example",
        fetchImpl: async () => new Response("nope", { status: 503 }),
      }, event),
    );

    const row = await fx.pool.query<{ status: string; last_error: string }>(
      `select status, last_error from workflow_event_waits where id = $1`,
      ["wait-retry"],
    );
    assert.equal(row.rows[0].status, "waiting");
    assert.match(row.rows[0].last_error, /status 503/);
  } finally {
    await fx.close();
  }
});
