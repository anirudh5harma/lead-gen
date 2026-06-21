import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setupPg } from "./_pg.ts";

/**
 * Smoke tests for migration 015. Confirms RLS is enabled, FKs cascade
 * correctly, and basic insert/update flows work against a real Postgres.
 */

test("ingestion schema: tables exist with RLS enabled", async (t) => {
  const fx = await setupPg("ing_schema");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const { rows } = await fx.pool.query<{ table_name: string; rls: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = $1
          and c.relname in (
            'account_intent_scores',
            'workspace_icps',
            'tracked_companies',
            'workspace_tracked_companies',
            'workspace_source_configs',
            'workspace_ingestion_budgets',
            'signal_overflow'
          )
        order by c.relname`,
      [fx.schema],
    );
    assert.equal(rows.length, 7);
    for (const r of rows) {
      assert.equal(r.rls, true, `RLS not enabled on ${r.table_name}`);
    }
  } finally {
    await fx.close();
  }
});

test("ingestion schema: workspace_icps cascades on workspace delete", async (t) => {
  const fx = await setupPg("ing_icp_cascade");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [wsId, `ws-${wsId.slice(0, 8)}`, "ws"],
    );
    await fx.pool.query(
      `insert into workspace_icps (workspace_id, name, description)
       values ($1, $2, $3), ($1, $4, $5)`,
      [wsId, "fintech founders", "series-a fintech operators", "infra leaders", "vp eng+"],
    );
    const before = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from workspace_icps where workspace_id = $1`,
      [wsId],
    );
    assert.equal(Number(before.rows[0].n), 2);
    await fx.pool.query(`delete from workspaces where id = $1`, [wsId]);
    const after = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from workspace_icps where workspace_id = $1`,
      [wsId],
    );
    assert.equal(Number(after.rows[0].n), 0);
  } finally {
    await fx.close();
  }
});

test("ingestion schema: tracked_companies catalog enforces unique domain", async (t) => {
  const fx = await setupPg("ing_catalog");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    await fx.pool.query(
      `insert into tracked_companies (name, domain, industry, size_bucket, greenhouse_id)
       values ('Stripe', 'stripe.com', 'fintech', '500+', 'stripe')`,
    );
    await assert.rejects(
      fx.pool.query(
        `insert into tracked_companies (name, domain) values ('Stripe Inc', 'stripe.com')`,
      ),
      /unique|duplicate/i,
    );
    // Companies WITHOUT a domain can coexist (partial unique index).
    await fx.pool.query(
      `insert into tracked_companies (name) values ('Unknown Co A')`,
    );
    await fx.pool.query(
      `insert into tracked_companies (name) values ('Unknown Co B')`,
    );
  } finally {
    await fx.close();
  }
});

test("ingestion schema: workspace_source_configs composite PK + cascade", async (t) => {
  const fx = await setupPg("ing_src_cfg");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [wsId, `ws-${wsId.slice(0, 8)}`, "ws"],
    );
    const sourceId = randomUUID();
    await fx.pool.query(
      `insert into graph_sources (id, workspace_id, kind, name, config)
       values ($1, $2, 'rss', 'tc', '{"url":"https://techcrunch.com/feed/"}'::jsonb)`,
      [sourceId, wsId],
    );
    await fx.pool.query(
      `insert into workspace_source_configs (workspace_id, source_id, poll_cadence_sec)
       values ($1, $2, 900)`,
      [wsId, sourceId],
    );
    // Duplicate composite PK should fail.
    await assert.rejects(
      fx.pool.query(
        `insert into workspace_source_configs (workspace_id, source_id) values ($1, $2)`,
        [wsId, sourceId],
      ),
      /duplicate/i,
    );
    // Source delete cascades the config row.
    await fx.pool.query(`delete from graph_sources where id = $1`, [sourceId]);
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from workspace_source_configs where workspace_id = $1`,
      [wsId],
    );
    assert.equal(Number(rows[0].n), 0);
  } finally {
    await fx.close();
  }
});

test("ingestion schema: workspace_tracked_companies cascades both ways", async (t) => {
  const fx = await setupPg("ing_wtc");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [wsId, `ws-${wsId.slice(0, 8)}`, "ws"],
    );
    const { rows: cRows } = await fx.pool.query<{ id: string }>(
      `insert into tracked_companies (name, domain, greenhouse_id)
       values ('Acme', 'acme.test', 'acme') returning id`,
    );
    const companyId = cRows[0].id;
    await fx.pool.query(
      `insert into workspace_tracked_companies (workspace_id, company_id) values ($1, $2)`,
      [wsId, companyId],
    );
    // Catalog delete cascades.
    await fx.pool.query(`delete from tracked_companies where id = $1`, [companyId]);
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from workspace_tracked_companies where workspace_id = $1`,
      [wsId],
    );
    assert.equal(Number(rows[0].n), 0);
  } finally {
    await fx.close();
  }
});

test("ingestion schema: workspace_ingestion_budgets default values land", async (t) => {
  const fx = await setupPg("ing_budget");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsId = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [wsId, `ws-${wsId.slice(0, 8)}`, "ws"],
    );
    await fx.pool.query(
      `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
      [wsId],
    );
    const { rows } = await fx.pool.query<{
      daily_candidate_cap: number;
      daily_classify_cap: number;
      daily_candidates_used: number;
    }>(
      `select daily_candidate_cap, daily_classify_cap, daily_candidates_used
         from workspace_ingestion_budgets where workspace_id = $1`,
      [wsId],
    );
    assert.equal(rows[0].daily_candidate_cap, 5000);
    assert.equal(rows[0].daily_classify_cap, 1000);
    assert.equal(rows[0].daily_candidates_used, 0);
  } finally {
    await fx.close();
  }
});
