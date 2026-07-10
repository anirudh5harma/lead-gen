import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { fanoutCandidate } from "../core/ingest/fanout.ts";
import {
  createIcp,
} from "../core/ingest/icps.ts";
import {
  addCompanyExplicit,
  upsertTrackedCompany,
} from "../core/ingest/catalog.ts";
import { ensurePlatformSource } from "../core/ingest/sources.ts";
import { ensureBudgetRow } from "../core/ingest/budget.ts";
import { registerSignalProjectors } from "../core/ingest/projectors.ts";

async function createProjectingBus(pool: Pool) {
  const bus = createInMemoryEventBus();
  await registerSignalProjectors({ pool, bus });
  return bus;
}

interface Seeded {
  pool: Pool;
  workspace_id: string;
  source_id: string;
  company_id: string;
}

async function seed(pool: Pool, opts: { candidate_cap?: number } = {}): Promise<Seeded> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id, daily_candidate_cap)
     values ($1, $2)`,
    [workspace_id, opts.candidate_cap ?? 100],
  );
  const company = await upsertTrackedCompany(pool, {
    name: "Stripe",
    domain: "stripe.test",
    industry: "fintech",
    size_bucket: "500+",
    greenhouse_id: "stripe",
  });
  await addCompanyExplicit(pool, workspace_id, company.id);
  const source = await ensurePlatformSource(pool, "greenhouse", "Greenhouse");
  return { pool, workspace_id, source_id: source.id, company_id: company.id };
}

async function insertCandidate(
  pool: Pool,
  source_id: string,
  company_id: string,
  structured: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `insert into signal_candidates (
       id, source_id, external_id, kind, company_id, title, content, url,
       structured, freshness_at
     ) values ($1, $2, $3, 'hiring', $4, $5, $6, $7, $8::jsonb, now())`,
    [
      id,
      source_id,
      `ext-${id.slice(0, 8)}`,
      company_id,
      "Staff Platform Engineer",
      "Build payment infra.",
      "https://boards.example/jobs/42",
      JSON.stringify(structured),
    ],
  );
  return id;
}

test("fanout: workspace with no ICPs receives every candidate that survives budget", async (t) => {
  const fx = await setupPg("fan_no_icp");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const s = await seed(fx.pool);
    const cand_id = await insertCandidate(fx.pool, s.source_id, s.company_id);
    const results = await fanoutCandidate(
      { pool: fx.pool, bus },
      {
        id: cand_id,
        source_id: s.source_id,
        kind: "hiring",
        company_id: s.company_id,
        title: "Staff Platform Engineer",
        content: "...",
        url: null,
        structured: { function: "engineering", seniority: "staff" },
        novelty_count: 1,
        freshness_at: new Date().toISOString(),
      },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "created");
    assert.ok(results[0].signal_id);

    // The projector consumes signal.discovered asynchronously; wait for the
    // workspace-scoped row to be materialized before asserting on it.
    await until(async () => {
      const r = await fx.pool.query<{ id: string }>(
        `select id from signals where id = $1`,
        [results[0].signal_id],
      );
      return r.rowCount === 1;
    });
    const { rows } = await fx.pool.query<{
      status: string;
      origin_candidate_id: string;
      kind: string;
    }>(
      `select status::text as status, origin_candidate_id, kind::text as kind
         from signals where id = $1`,
      [results[0].signal_id],
    );
    assert.equal(rows[0].status, "ingested");
    assert.equal(rows[0].origin_candidate_id, cand_id);
    assert.equal(rows[0].kind, "hiring");

    // bus emitted signal.discovered → projector → signal.ingested.
    await until(() =>
      bus.published.filter((e) => e.event_type === "signal.ingested").length === 1,
    );
    const discovered = bus.published.filter((e) => e.event_type === "signal.discovered");
    assert.equal(discovered.length, 1);
    const ingested = bus.published.filter((e) => e.event_type === "signal.ingested");
    assert.equal(ingested.length, 1);

    // fanout audit row recorded.
    const { rows: aud } = await fx.pool.query<{ outcome: string }>(
      `select outcome from signal_candidate_fanouts where candidate_id = $1`,
      [cand_id],
    );
    assert.equal(aud[0].outcome, "created");
  } finally {
    await fx.close();
  }
});

test("fanout: product launch catalog names use organization domain names", async (t) => {
  const fx = await setupPg("fan_launch_company");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const s = await seed(fx.pool);
    const tracked = await upsertTrackedCompany(fx.pool, {
      name: "GPT-5.6",
      domain: "openai.com",
      properties: { source: "product_hunt", kind: "product_launch" },
    });
    await addCompanyExplicit(fx.pool, s.workspace_id, tracked.id);
    const cand_id = await insertCandidate(
      fx.pool,
      s.source_id,
      tracked.id,
      { name: "GPT-5.6", website: "https://openai.com" },
    );

    const results = await fanoutCandidate(
      { pool: fx.pool, bus },
      {
        id: cand_id,
        source_id: s.source_id,
        kind: "product_launch",
        company_id: tracked.id,
        title: "GPT-5.6",
        content: null,
        url: "https://www.producthunt.com/posts/gpt-5-6",
        structured: { name: "GPT-5.6", website: "https://openai.com" },
        novelty_count: 1,
        freshness_at: new Date().toISOString(),
      },
    );
    assert.equal(results[0].outcome, "created");
    await until(async () => {
      const r = await fx.pool.query<{ company_name: string | null }>(
        `select gc.name as company_name
           from signals s
           join graph_companies gc on gc.id = s.related_company_id
          where s.id = $1`,
        [results[0].signal_id],
      );
      return r.rows[0]?.company_name ?? null;
    });
    const { rows } = await fx.pool.query<{
      company_name: string | null;
      company_domain: string | null;
    }>(
      `select gc.name as company_name, gc.domain as company_domain
         from signals s
         join graph_companies gc on gc.id = s.related_company_id
        where s.id = $1`,
      [results[0].signal_id],
    );
    assert.equal(rows[0].company_name, "OpenAI");
    assert.equal(rows[0].company_domain, "openai.com");
  } finally {
    await fx.close();
  }
});

test("fanout: ICP must_haves filter skips candidates that don't pass", async (t) => {
  const fx = await setupPg("fan_must");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const s = await seed(fx.pool);
    // ICP that only wants funding signals — hiring candidate should be skipped.
    await createIcp(fx.pool, s.workspace_id, {
      name: "Series-A founders",
      description: "Founders raising Series A",
      must_haves: [{ field: "kind", op: "in", value: ["funding"] }],
      nice_to_haves: [],
      match_threshold: 0.6,
      enabled: true,
    });
    const cand_id = await insertCandidate(fx.pool, s.source_id, s.company_id);
    const results = await fanoutCandidate(
      { pool: fx.pool, bus },
      {
        id: cand_id,
        source_id: s.source_id,
        kind: "hiring",
        company_id: s.company_id,
        title: "Staff Engineer",
        content: null,
        url: null,
        structured: {},
        novelty_count: 1,
        freshness_at: new Date().toISOString(),
      },
    );
    assert.equal(results[0].outcome, "skipped:must_haves");
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from signals where workspace_id = $1`,
      [s.workspace_id],
    );
    assert.equal(Number(rows[0].n), 0);
  } finally {
    await fx.close();
  }
});

test("fanout: budget cap → skipped:budget + overflow audit", async (t) => {
  const fx = await setupPg("fan_budget");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const s = await seed(fx.pool, { candidate_cap: 0 });
    await ensureBudgetRow(fx.pool, s.workspace_id);
    const cand_id = await insertCandidate(fx.pool, s.source_id, s.company_id);
    const results = await fanoutCandidate(
      { pool: fx.pool, bus },
      {
        id: cand_id,
        source_id: s.source_id,
        kind: "hiring",
        company_id: s.company_id,
        title: "x",
        content: null,
        url: null,
        structured: {},
        novelty_count: 1,
        freshness_at: new Date().toISOString(),
      },
    );
    assert.equal(results[0].outcome, "skipped:budget");
    const { rows: ovf } = await fx.pool.query<{ reason: string }>(
      `select reason from signal_overflow where workspace_id = $1`,
      [s.workspace_id],
    );
    assert.equal(ovf[0].reason, "daily_cap_reached");
  } finally {
    await fx.close();
  }
});

test("fanout: idempotent — second call for the same (candidate, workspace) is skipped:dedup", async (t) => {
  const fx = await setupPg("fan_dedup");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const s = await seed(fx.pool);
    const cand_id = await insertCandidate(fx.pool, s.source_id, s.company_id);
    const deps = { pool: fx.pool, bus };
    const cand = {
      id: cand_id,
      source_id: s.source_id,
      kind: "hiring" as const,
      company_id: s.company_id,
      title: "x",
      content: null,
      url: null,
      structured: {},
      novelty_count: 1,
      freshness_at: new Date().toISOString(),
    };
    const first = await fanoutCandidate(deps, cand);
    const second = await fanoutCandidate(deps, cand);
    assert.equal(first[0].outcome, "created");
    assert.equal(second[0].outcome, "skipped:dedup");
    // Wait for the projector to materialize the single signals row.
    await until(async () => {
      const r = await fx.pool.query<{ n: string }>(
        `select count(*)::text as n from signals where workspace_id = $1`,
        [s.workspace_id],
      );
      return Number(r.rows[0].n) === 1;
    });
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from signals where workspace_id = $1`,
      [s.workspace_id],
    );
    assert.equal(Number(rows[0].n), 1);
  } finally {
    await fx.close();
  }
});

test("fanout: multiple workspaces tracking the same company each get a signal", async (t) => {
  const fx = await setupPg("fan_multi");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const s = await seed(fx.pool);
    // Second workspace also tracks Stripe.
    const ws2 = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [ws2, `ws-${ws2.slice(0, 8)}`, "ws2"],
    );
    await addCompanyExplicit(fx.pool, ws2, s.company_id);
    const cand_id = await insertCandidate(fx.pool, s.source_id, s.company_id);
    const results = await fanoutCandidate(
      { pool: fx.pool, bus },
      {
        id: cand_id,
        source_id: s.source_id,
        kind: "hiring",
        company_id: s.company_id,
        title: "x",
        content: null,
        url: null,
        structured: {},
        novelty_count: 1,
        freshness_at: new Date().toISOString(),
      },
    );
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.outcome === "created"));
    await until(async () => {
      const r = await fx.pool.query<{ n: string }>(
        `select count(*)::text as n from signals where origin_candidate_id = $1`,
        [cand_id],
      );
      return Number(r.rows[0].n) === 2;
    });
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from signals where origin_candidate_id = $1`,
      [cand_id],
    );
    assert.equal(Number(rows[0].n), 2);
  } finally {
    await fx.close();
  }
});
