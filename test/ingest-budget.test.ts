import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  ensureBudgetRow,
  reserveCandidate,
  reserveClassify,
  refundCandidate,
  recordOverflow,
  readBudget,
} from "../core/ingest/budget.ts";

async function seedWorkspace(
  pool: Pool,
  opts: { candidate_cap?: number; classify_cap?: number } = {},
): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "ws"],
  );
  if (opts.candidate_cap !== undefined || opts.classify_cap !== undefined) {
    await pool.query(
      `insert into workspace_ingestion_budgets (workspace_id, daily_candidate_cap, daily_classify_cap)
       values ($1, coalesce($2, 5000), coalesce($3, 1000))`,
      [ws, opts.candidate_cap ?? null, opts.classify_cap ?? null],
    );
  }
  return ws;
}

test("budget: ensureBudgetRow is idempotent and returns defaults", async (t) => {
  const fx = await setupPg("bud_ensure");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const first = await ensureBudgetRow(fx.pool, ws);
    assert.equal(first.daily_candidate_cap, 5000);
    assert.equal(first.daily_classify_cap, 1000);
    assert.equal(first.daily_candidates_used, 0);

    const second = await ensureBudgetRow(fx.pool, ws);
    assert.equal(second.workspace_id, first.workspace_id);
  } finally {
    await fx.close();
  }
});

test("budget: reserveCandidate atomic increment honours cap", async (t) => {
  const fx = await setupPg("bud_reserve");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool, { candidate_cap: 3 });
    assert.equal(await reserveCandidate(fx.pool, ws), true);
    assert.equal(await reserveCandidate(fx.pool, ws), true);
    assert.equal(await reserveCandidate(fx.pool, ws), true);
    // At cap.
    assert.equal(await reserveCandidate(fx.pool, ws), false);

    const state = await readBudget(fx.pool, ws);
    assert.equal(state?.daily_candidates_used, 3);
  } finally {
    await fx.close();
  }
});

test("budget: 24h rollover resets the candidate counter", async (t) => {
  const fx = await setupPg("bud_rollover");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool, { candidate_cap: 1 });
    assert.equal(await reserveCandidate(fx.pool, ws), true);
    assert.equal(await reserveCandidate(fx.pool, ws), false);

    // Backdate the window 25 hours.
    await fx.pool.query(
      `update workspace_ingestion_budgets set window_start = now() - interval '25 hours' where workspace_id = $1`,
      [ws],
    );
    assert.equal(await reserveCandidate(fx.pool, ws), true);
    const state = await readBudget(fx.pool, ws);
    assert.equal(state?.daily_candidates_used, 1);
  } finally {
    await fx.close();
  }
});

test("budget: refundCandidate decrements (clamped to 0)", async (t) => {
  const fx = await setupPg("bud_refund");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    await ensureBudgetRow(fx.pool, ws);
    await reserveCandidate(fx.pool, ws);
    await reserveCandidate(fx.pool, ws);
    await refundCandidate(fx.pool, ws);
    const state = await readBudget(fx.pool, ws);
    assert.equal(state?.daily_candidates_used, 1);

    // Refund past zero clamps.
    await refundCandidate(fx.pool, ws);
    await refundCandidate(fx.pool, ws);
    const after = await readBudget(fx.pool, ws);
    assert.equal(after?.daily_candidates_used, 0);
  } finally {
    await fx.close();
  }
});

test("budget: classify counter is separate from candidate counter", async (t) => {
  const fx = await setupPg("bud_classify");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool, { classify_cap: 2 });
    assert.equal(await reserveClassify(fx.pool, ws), true);
    assert.equal(await reserveClassify(fx.pool, ws), true);
    assert.equal(await reserveClassify(fx.pool, ws), false);

    // Candidate counter unaffected.
    assert.equal(await reserveCandidate(fx.pool, ws), true);
  } finally {
    await fx.close();
  }
});

test("budget: recordOverflow writes audit row", async (t) => {
  const fx = await setupPg("bud_overflow");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    await recordOverflow(fx.pool, ws, null, "daily_cap_reached", {
      external_id: "x-1",
    });
    const { rows } = await fx.pool.query<{ reason: string; payload: { external_id?: string } }>(
      `select reason, payload from signal_overflow where workspace_id = $1`,
      [ws],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "daily_cap_reached");
    assert.equal(rows[0].payload.external_id, "x-1");
  } finally {
    await fx.close();
  }
});
