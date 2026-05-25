import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg } from "./_pg.ts";

/**
 * Smoke tests for migration 016. Verifies the shared candidates pool +
 * fanout audit cascade correctly and enforce the uniqueness invariants
 * that the catalog poll relies on.
 */

async function seedCatalogCompany(
  pool: import("pg").Pool,
  greenhouseId = "stripe",
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into tracked_companies (name, domain, industry, greenhouse_id)
     values ('Stripe', $1, 'fintech', $2) returning id`,
    [`stripe-${randomUUID().slice(0, 8)}.com`, greenhouseId],
  );
  return rows[0].id;
}

async function seedSource(
  pool: import("pg").Pool,
  workspaceId: string,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name)
     values ($1, $2, 'web_monitor', 'greenhouse:stripe')`,
    [id, workspaceId],
  );
  return id;
}

async function seedWorkspace(pool: import("pg").Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "ws"],
  );
  return ws;
}

test("candidates schema: tables exist with RLS", async (t) => {
  const fx = await setupPg("cand_schema");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { rows } = await fx.pool.query<{ table_name: string; rls: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1
          and c.relname in ('signal_candidates', 'signal_candidate_fanouts')`,
      [fx.schema],
    );
    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.equal(r.rls, true, `RLS not enabled on ${r.table_name}`);
    }
  } finally {
    await fx.close();
  }
});

test("candidates: (source_id, external_id) is globally unique", async (t) => {
  const fx = await setupPg("cand_unique");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = await seedWorkspace(fx.pool);
    const sourceId = await seedSource(fx.pool, wsId);

    await fx.pool.query(
      `insert into signal_candidates (
         source_id, external_id, title, freshness_at
       ) values ($1, $2, $3, now())`,
      [sourceId, "gh-job-42", "Staff Platform Engineer"],
    );
    await assert.rejects(
      fx.pool.query(
        `insert into signal_candidates (
           source_id, external_id, title, freshness_at
         ) values ($1, $2, $3, now())`,
        [sourceId, "gh-job-42", "Duplicate that should fail"],
      ),
      /unique|duplicate/i,
    );

    // Same external_id under a DIFFERENT source is fine.
    const sourceId2 = await seedSource(fx.pool, wsId);
    await fx.pool.query(
      `insert into signal_candidates (source_id, external_id, title, freshness_at)
       values ($1, $2, $3, now())`,
      [sourceId2, "gh-job-42", "Different source, same id"],
    );
  } finally {
    await fx.close();
  }
});

test("candidates: company FK cascades on tracked_companies delete (SET NULL)", async (t) => {
  const fx = await setupPg("cand_co_cascade");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = await seedWorkspace(fx.pool);
    const sourceId = await seedSource(fx.pool, wsId);
    const companyId = await seedCatalogCompany(fx.pool);
    const { rows } = await fx.pool.query<{ id: string }>(
      `insert into signal_candidates (
         source_id, external_id, kind, company_id, title, freshness_at
       ) values ($1, 'ext-1', 'hiring', $2, 'x', now()) returning id`,
      [sourceId, companyId],
    );
    const candidateId = rows[0].id;

    await fx.pool.query(`delete from tracked_companies where id = $1`, [companyId]);
    const after = await fx.pool.query<{ company_id: string | null }>(
      `select company_id from signal_candidates where id = $1`,
      [candidateId],
    );
    assert.equal(after.rows[0].company_id, null);
  } finally {
    await fx.close();
  }
});

test("candidates: status flips between 'active' and 'expired'", async (t) => {
  const fx = await setupPg("cand_status");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = await seedWorkspace(fx.pool);
    const sourceId = await seedSource(fx.pool, wsId);
    const { rows } = await fx.pool.query<{ id: string }>(
      `insert into signal_candidates (source_id, external_id, title, freshness_at)
       values ($1, 'ext-99', 'x', now()) returning id`,
      [sourceId],
    );
    const id = rows[0].id;
    await fx.pool.query(
      `update signal_candidates set status = 'expired', expired_at = now() where id = $1`,
      [id],
    );
    await assert.rejects(
      fx.pool.query(
        `update signal_candidates set status = 'unknown' where id = $1`,
        [id],
      ),
      /check/i,
    );
  } finally {
    await fx.close();
  }
});

test("fanouts: composite PK + outcome enum + workspace cascade", async (t) => {
  const fx = await setupPg("fanout");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = await seedWorkspace(fx.pool);
    const sourceId = await seedSource(fx.pool, wsId);
    const { rows } = await fx.pool.query<{ id: string }>(
      `insert into signal_candidates (source_id, external_id, title, freshness_at)
       values ($1, 'ext-1', 'x', now()) returning id`,
      [sourceId],
    );
    const candId = rows[0].id;

    await fx.pool.query(
      `insert into signal_candidate_fanouts (candidate_id, workspace_id, outcome)
       values ($1, $2, 'created')`,
      [candId, wsId],
    );
    await assert.rejects(
      fx.pool.query(
        `insert into signal_candidate_fanouts (candidate_id, workspace_id, outcome)
         values ($1, $2, 'created')`,
        [candId, wsId],
      ),
      /duplicate/i,
    );
    await assert.rejects(
      fx.pool.query(
        `insert into signal_candidate_fanouts (candidate_id, workspace_id, outcome)
         values ($1, $2, 'banana')`,
        [candId, wsId],
      ),
      /check/i,
    );

    await fx.pool.query(`delete from workspaces where id = $1`, [wsId]);
    const after = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from signal_candidate_fanouts where candidate_id = $1`,
      [candId],
    );
    assert.equal(Number(after.rows[0].n), 0);
  } finally {
    await fx.close();
  }
});

test("signals.origin_candidate_id links back to the shared pool", async (t) => {
  const fx = await setupPg("origin_link");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = await seedWorkspace(fx.pool);
    const sourceId = await seedSource(fx.pool, wsId);
    const { rows: candRows } = await fx.pool.query<{ id: string }>(
      `insert into signal_candidates (source_id, external_id, kind, title, freshness_at)
       values ($1, 'ext-1', 'hiring', 'x', now()) returning id`,
      [sourceId],
    );
    const candId = candRows[0].id;
    const { rows: sigRows } = await fx.pool.query<{ id: string }>(
      `insert into signals (
         workspace_id, kind, title, freshness_at, status, origin_candidate_id
       ) values ($1, 'hiring', 'x', now(), 'ingested', $2) returning id`,
      [wsId, candId],
    );
    const sigId = sigRows[0].id;

    // Deleting the candidate nulls the back-reference (does not delete signal).
    await fx.pool.query(`delete from signal_candidates where id = $1`, [candId]);
    const after = await fx.pool.query<{ origin_candidate_id: string | null }>(
      `select origin_candidate_id from signals where id = $1`,
      [sigId],
    );
    assert.equal(after.rows[0].origin_candidate_id, null);
  } finally {
    await fx.close();
  }
});
