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

test("postgres workflow runtime: persisted approval wakes locally without LISTEN delivery", async (t) => {
  const fx = await setupPg("pg_wf_appr_local");
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
        name: "demo_appr_local",
        version: "1",
        async run(_input, ctx) {
          const decision = await ctx.requestApproval({
            kind: "outbound.email.send",
            payload: { to: "recover@example.com" },
          });
          return decision.decision;
        },
      }),
    );
    const run = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_appr_local",
      input: null,
    });
    const approval = await until(async () => {
      const { rows } = await fx.pool.query<{ id: string }>(
        `select id from workflow_approvals where run_id = $1`,
        [run.id],
      );
      return rows[0];
    });

    await bus.close();
    await runtime.resolveApproval(approval.id, { decision: "approved" });
    await until(async () => (await runtime.get(run.id))?.status === "completed");
    assert.equal((await runtime.get(run.id))?.output, "approved");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres workflow runtime: resume replays checkpoints and continues after approved gate", async (t) => {
  const fx = await setupPg("pg_wf_resume");
  if (!fx) return t.skip("DATABASE_URL not set");

  const busA = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  let sideEffects = 0;
  try {
    const ws = await seedWorkspace(fx.pool);
    const workflow = defineWorkflow<unknown, string>({
      name: "demo_resume",
      version: "1",
      async run(_input, ctx) {
        const value = await ctx.step("once", async () => {
          sideEffects++;
          return "checkpointed";
        });
        const d = await ctx.requestApproval({
          kind: "outbound.email.send",
          payload: { value },
        });
        return `${value}:${d.decision}`;
      },
    });
    const runtimeA = createPostgresWorkflowRuntime({ pool: fx.pool, bus: busA });
    runtimeA.register(workflow);
    const run = await runtimeA.start({
      workspace_id: ws,
      workflow_name: "demo_resume",
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
    await busA.close();

    const busB = await createPostgresEventBus({
      pool: fx.pool,
      listenConnectionString: process.env.DATABASE_URL,
    });
    try {
      const runtimeB = createPostgresWorkflowRuntime({ pool: fx.pool, bus: busB });
      runtimeB.register(workflow);
      await runtimeB.resolveApproval(approval.id, {
        decision: "approved",
        decided_by: randomUUID(),
      });
      await runtimeB.resume(run.id);
      await until(async () => (await runtimeB.get(run.id))?.status === "completed");
      const final = await runtimeB.get(run.id);
      assert.equal(final?.output, "checkpointed:approved");
      assert.equal(sideEffects, 1);
    } finally {
      await busB.close();
    }
  } finally {
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

    const raceKey = "same-key-race";
    const [raceFirst, raceSecond] = await Promise.all([
      runtime.start({
        workspace_id: ws,
        workflow_name: "demo_idem",
        input: null,
        idempotency_key: raceKey,
      }),
      runtime.start({
        workspace_id: ws,
        workflow_name: "demo_idem",
        input: null,
        idempotency_key: raceKey,
      }),
    ]);
    assert.equal(raceFirst.id, raceSecond.id);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("postgres workflow runtime: play runs project workflow state", async (t) => {
  const fx = await setupPg("pg_wf_play");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const ws = await seedWorkspace(fx.pool);
    const rep_id = randomUUID();
    await fx.pool.query(
      `insert into reps (id, workspace_id, name, role, status, persona, channels, autonomy)
       values ($1, $2, 'Maya', 'sdr', 'active', $3::jsonb, $4::text[], $5::jsonb)`,
      [
        rep_id,
        ws,
        JSON.stringify({ voice: "warm" }),
        ["email"],
        JSON.stringify({ channels: {}, global: {} }),
      ],
    );
    const play_id = randomUUID();
    await fx.pool.query(
      `insert into plays (
         id, workspace_id, name, declaration, compiled, compiler_version, autonomy, status
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, 'active')`,
      [
        play_id,
        ws,
        "Funding signal",
        "When a funding signal arrives, run a founder email play.",
        JSON.stringify({ trigger: { kind: "signal" }, steps: [] }),
        "test",
        JSON.stringify({ channels: { email: { approval: "none" } }, global: {} }),
      ],
    );
    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });

    runtime.register(
      defineWorkflow<{ rep_id: string }, { ok: boolean }>({
        name: "demo_play_projection",
        version: "1",
        async run(input, ctx) {
          assert.equal(input.rep_id, rep_id);
          return ctx.step("project", async () => ({ ok: true }));
        },
      }),
    );

    const requested_play_run_id = randomUUID();
    const run = await runtime.start({
      workspace_id: ws,
      workflow_name: "demo_play_projection",
      play_id,
      play_run_id: requested_play_run_id,
      input: { rep_id },
    });

    assert.equal(run.play_run_id, requested_play_run_id);
    await until(async () => (await runtime.get(run.id))?.status === "completed");

    const projected = await fx.pool.query<{
      id: string;
      workflow_run_id: string;
      status: string;
      output: unknown;
    }>(
      `select id, workflow_run_id, status, output
         from play_runs
        where workflow_run_id = $1`,
      [run.id],
    );
    assert.equal(projected.rows.length, 1);
    assert.equal(projected.rows[0].id, requested_play_run_id);
    assert.equal(projected.rows[0].status, "completed");
    assert.deepEqual(projected.rows[0].output, { ok: true });

    const workflow = await fx.pool.query<{ play_run_id: string | null }>(
      `select play_run_id from workflow_runs where id = $1`,
      [run.id],
    );
    assert.equal(workflow.rows[0].play_run_id, requested_play_run_id);
  } finally {
    await bus.close();
    await fx.close();
  }
});
