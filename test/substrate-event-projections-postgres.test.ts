import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setupPg } from "./_pg.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import {
  runDurableEventProjectionsOnce,
  type DurableEventProjection,
} from "../core/substrate/events/index.ts";

test("event projections: catch up missed events exactly once and recover expired leases", async (t) => {
  const fx = await setupPg("event_projections");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `projection-${workspace_id.slice(0, 8)}`, "projection"],
    );
    const first = await bus.publish({
      workspace_id,
      event_type: "signal.dismissed",
      source: "system",
      payload: { signal_id: randomUUID(), reason: "first" },
    });
    const applied: string[] = [];
    const projection: DurableEventProjection = {
      name: "test.signal_dismissed.v1",
      eventTypes: ["signal.dismissed"],
      async apply(event) {
        applied.push(event.id);
      },
    };

    const initial = await runDurableEventProjectionsOnce(fx.pool, [projection], {
      leaseOwner: "worker-a",
    });
    assert.equal(initial.completed, 1);
    assert.deepEqual(applied, [first.id]);

    const duplicate = await runDurableEventProjectionsOnce(fx.pool, [projection], {
      leaseOwner: "worker-b",
    });
    assert.equal(duplicate.claimed, 0);
    assert.deepEqual(applied, [first.id]);

    const second = await bus.publish({
      workspace_id,
      event_type: "signal.dismissed",
      source: "system",
      payload: { signal_id: randomUUID(), reason: "second" },
    });
    await fx.pool.query(
      `insert into event_projection_jobs (
         projection_name, event_id, workspace_id, event_type, status,
         attempt_count, lease_owner, lease_expires_at
       ) values ($1, $2, $3, 'signal.dismissed', 'running', 1, 'dead-worker', now() - interval '1 minute')`,
      [projection.name, second.id, workspace_id],
    );
    const recovered = await runDurableEventProjectionsOnce(fx.pool, [projection], {
      leaseOwner: "worker-c",
    });
    assert.equal(recovered.completed, 1);
    assert.deepEqual(applied, [first.id, second.id]);

    const jobs = await fx.pool.query<{ status: string; attempt_count: number }>(
      `select status, attempt_count
         from event_projection_jobs
        where projection_name = $1
        order by created_at asc`,
      [projection.name],
    );
    assert.deepEqual(jobs.rows.map((row) => row.status), ["completed", "completed"]);
    assert.equal(jobs.rows[1].attempt_count, 2);
  } finally {
    await bus.close();
    await fx.close();
  }
});
