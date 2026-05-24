import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import { createPostgresWorkflowRuntime } from "../core/substrate/workflows/adapters/postgres.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "test ws"],
  );
  return ws;
}

test("postgres workflow runtime: step result is journaled to workflow_checkpoints", async (t) => {
  const fx = await setupPg("pg_wf_step");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });

    runtime.register(
      defineWorkflow<unknown, number>({
        name: "demo_step",
        version: "1",
        async run(_input, ctx) {
          const a = await ctx.step("a", async () => 41);
          return a + 1;
        },
      }),
    );

    const run = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_step",
      input: null,
    });

    await until(async () => (await runtime.get(run.id))?.status === "completed");
    const final = await runtime.get(run.id);
    assert.equal(final?.status, "completed");
    assert.equal(final?.output, 42);

    const ck = await fx.pool.query<{ position: number; data: unknown }>(
      `select position, data from workflow_checkpoints where run_id = $1 order by position`,
      [run.id],
    );
    assert.equal(ck.rows.length, 1);
    assert.equal(ck.rows[0].position, 0);
    assert.equal(ck.rows[0].data, 41);

    const steps = await fx.pool.query<{ status: string; output: unknown }>(
      `select status, output from workflow_steps where run_id = $1`,
      [run.id],
    );
    assert.equal(steps.rows.length, 1);
    assert.equal(steps.rows[0].status, "completed");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres workflow runtime: retries on failure and records each attempt", async (t) => {
  const fx = await setupPg("pg_wf_retry");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });

    let attempts = 0;
    runtime.register(
      defineWorkflow<unknown, string>({
        name: "demo_retry",
        version: "1",
        async run(_input, ctx) {
          return ctx.step(
            "flaky",
            async () => {
              attempts++;
              if (attempts < 3) throw new Error("flake");
              return "ok";
            },
            { retry: { max_attempts: 5, backoff: "fixed", base_ms: 1 } },
          );
        },
      }),
    );

    const run = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_retry",
      input: null,
    });
    await until(async () => (await runtime.get(run.id))?.status === "completed");

    const steps = await fx.pool.query<{ attempt: number; status: string }>(
      `select attempt, status from workflow_steps where run_id = $1 order by attempt`,
      [run.id],
    );
    assert.equal(steps.rows.length, 3);
    assert.deepEqual(
      steps.rows.map((r) => r.status),
      ["failed", "failed", "completed"],
    );
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres workflow runtime: requestApproval persists + resolveApproval wakes the run", async (t) => {
  const fx = await setupPg("pg_wf_appr");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });

    runtime.register(
      defineWorkflow<unknown, string>({
        name: "demo_appr",
        version: "1",
        async run(_input, ctx) {
          const d = await ctx.requestApproval({
            kind: "outbound.email.send",
            payload: { to: "anne@example.com" },
          });
          return d.decision;
        },
      }),
    );

    const run = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_appr",
      input: null,
    });

    const approval = await until(async () => {
      const { rows } = await fx.pool.query<{ id: string; decision: string }>(
        `select id, decision from workflow_approvals where run_id = $1`,
        [run.id],
      );
      return rows[0];
    });
    assert.equal(approval.decision, "pending");

    await runtime.resolveApproval(approval.id, {
      decision: "approved",
      decided_by: randomUUID(),
    });

    await until(async () => (await runtime.get(run.id))?.status === "completed");
    const final = await runtime.get(run.id);
    assert.equal(final?.status, "completed");
    assert.equal(final?.output, "approved");

    const after = await fx.pool.query<{ decision: string }>(
      `select decision from workflow_approvals where id = $1`,
      [approval.id],
    );
    assert.equal(after.rows[0].decision, "approved");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres workflow runtime: idempotency_key collapses duplicate starts", async (t) => {
  const fx = await setupPg("pg_wf_idem");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });

    runtime.register(
      defineWorkflow<unknown, number>({
        name: "demo_idem",
        version: "1",
        async run(_input, ctx) {
          return ctx.step("a", async () => 1);
        },
      }),
    );

    const key = "same-key-1";
    const first = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_idem",
      input: null,
      idempotency_key: key,
    });
    // Let the first run complete before issuing the duplicate so the
    // idempotency lookup sees the persisted row.
    await until(async () => (await runtime.get(first.id))?.status === "completed");

    const second = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_idem",
      input: null,
      idempotency_key: key,
    });
    assert.equal(first.id, second.id);
  } finally {
    await bus.close();
    await fx.close();
  }
});
