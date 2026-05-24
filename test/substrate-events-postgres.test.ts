import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg, until } from "./_pg.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";

async function seedWorkspace(pool: import("pg").Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "test ws"],
  );
  return ws;
}

test("postgres event bus: publish writes to events and wakes a LISTEN subscriber", async (t) => {
  const fx = await setupPg("pg_events");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const seen: string[] = [];

    await bus.subscribe("signal.ingested", (e) => {
      // The published event payload comes back from the bus after the trigger
      // → NOTIFY → SELECT round-trip.
      seen.push((e.payload as { kind: string }).kind);
    });

    await bus.publish({
      workspace_id: ws,
      event_type: "signal.ingested",
      source: "system",
      payload: {
        signal_id: randomUUID(),
        source_id: null,
        kind: "funding",
        novelty_score: 0.7,
      },
    });

    await until(() => seen.length === 1);
    assert.deepEqual(seen, ["funding"]);

    const { rows } = await fx.pool.query<{ event_type: string }>(
      `select event_type from events where workspace_id = $1`,
      [ws],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_type, "signal.ingested");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres event bus: wildcard subscriber receives every event", async (t) => {
  const fx = await setupPg("pg_wild");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const types: string[] = [];
    await bus.subscribe("*", (e) => {
      types.push(e.event_type);
    });

    await bus.publish({
      workspace_id: ws,
      event_type: "signal.ingested",
      source: "system",
      payload: {
        signal_id: randomUUID(),
        source_id: null,
        kind: "hiring",
        novelty_score: null,
      },
    });
    await bus.publish({
      workspace_id: ws,
      event_type: "draft.proposed",
      source: "agent",
      payload: {
        conversation_id: randomUUID(),
        message_id: randomUUID(),
        channel: "email",
        rep_id: randomUUID(),
      },
    });

    await until(() => types.length === 2);
    assert.deepEqual(types.sort(), ["draft.proposed", "signal.ingested"]);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres event bus: workspaceId filter scopes subscribers", async (t) => {
  const fx = await setupPg("pg_scope");
  if (!fx) return t.skip("DATABASE_URL not set");

  const wsA = await seedWorkspace(fx.pool);
  const wsB = await seedWorkspace(fx.pool);

  const busA = await createPostgresEventBus({
    pool: fx.pool,
    workspaceId: wsA,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seen: string[] = [];
    await busA.subscribe("*", (e) => seen.push(e.workspace_id));

    // Publish on workspace B from a separate publisher.
    const busB = await createPostgresEventBus({
      pool: fx.pool,
      listenConnectionString: process.env.DATABASE_URL,
    });
    try {
      await busB.publish({
        workspace_id: wsB,
        event_type: "signal.dismissed",
        source: "system",
        payload: { signal_id: randomUUID(), reason: "test" },
      });

      // And one on workspace A so we have something busA cares about.
      await busA.publish({
        workspace_id: wsA,
        event_type: "signal.dismissed",
        source: "system",
        payload: { signal_id: randomUUID(), reason: "test" },
      });
    } finally {
      await busB.close();
    }

    await until(() => seen.length >= 1, { timeout: 1500 });
    // Give the wsB notify a chance to also (incorrectly) reach busA before
    // we assert. 200ms is generous on a local Postgres.
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(seen, [wsA]);
  } finally {
    await busA.close();
    await fx.close();
  }
});

test("postgres event bus: rejects unknown event types and bad payloads", async (t) => {
  const fx = await setupPg("pg_val");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    await assert.rejects(
      bus.publish({
        workspace_id: ws,
        // @ts-expect-error — intentional
        event_type: "bogus.event",
        source: "system",
        payload: {},
      }),
      /Unknown event_type/,
    );
    await assert.rejects(
      bus.publish({
        workspace_id: ws,
        event_type: "signal.matched",
        source: "system",
        // @ts-expect-error — out-of-range match_score
        payload: { signal_id: randomUUID(), match_score: 1.5 },
      }),
    );
  } finally {
    await bus.close();
    await fx.close();
  }
});
