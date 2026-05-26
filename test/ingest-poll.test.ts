import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { createMockEmbeddingClient } from "../core/ingest/embeddings.ts";
import { pollOnce } from "../core/ingest/poll.ts";
import { greenhouseAdapter } from "../core/ingest/adapters/greenhouse.ts";
import {
  addCompanyExplicit,
  getTrackedCompany,
  upsertTrackedCompany,
} from "../core/ingest/catalog.ts";
import { ensurePlatformSource, loadCursor } from "../core/ingest/sources.ts";

interface Seeded {
  workspace_id: string;
  source_id: string;
  company_id: string;
}

async function seed(pool: Pool): Promise<Seeded> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
    [workspace_id],
  );
  const co = await upsertTrackedCompany(pool, {
    name: "Stripe",
    domain: "stripe.test",
    industry: "fintech",
    greenhouse_id: "stripe",
  });
  await addCompanyExplicit(pool, workspace_id, co.id);
  const src = await ensurePlatformSource(pool, "greenhouse", "Greenhouse");
  return { workspace_id, source_id: src.id, company_id: co.id };
}

function ghJobsResponse(jobs: Array<{ id: number; title: string; updated_at?: string }>): Response {
  return new Response(JSON.stringify({ jobs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("pollOnce: inserts new candidates, fans out, returns counts", async (t) => {
  const fx = await setupPg("poll_basic");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const s = await seed(fx.pool);
    const company = (await getTrackedCompany(fx.pool, s.company_id))!;
    const fetchImpl = (async () =>
      ghJobsResponse([
        { id: 1, title: "Staff Engineer", updated_at: "2026-05-24T00:00:00Z" },
        { id: 2, title: "Senior PM", updated_at: "2026-05-24T00:00:00Z" },
      ])) as unknown as typeof fetch;

    const outcome = await pollOnce(
      { pool: fx.pool, bus, embedder: createMockEmbeddingClient(), fetchImpl },
      { source_id: s.source_id, adapter: greenhouseAdapter, company },
    );
    assert.equal(outcome.inserted, 2);
    assert.equal(outcome.duplicates, 0);
    assert.equal(outcome.fanned_out, 2);
    assert.equal(outcome.expired, 0);

    // Cursor saved with the seen external_ids.
    const cursor = await loadCursor(fx.pool, s.source_id, s.company_id);
    assert.deepEqual(cursor.last_external_ids.sort(), ["1", "2"]);
    assert.ok(cursor.last_polled_at);
  } finally {
    await fx.close();
  }
});

test("pollOnce: re-poll with same upstream is a no-op (dedup)", async (t) => {
  const fx = await setupPg("poll_dedup");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const s = await seed(fx.pool);
    const company = (await getTrackedCompany(fx.pool, s.company_id))!;
    const jobs = [{ id: 1, title: "Staff Engineer", updated_at: "2026-05-24T00:00:00Z" }];
    const fetchImpl = (async () => ghJobsResponse(jobs)) as unknown as typeof fetch;

    const deps = { pool: fx.pool, bus, embedder: createMockEmbeddingClient(), fetchImpl };
    const first = await pollOnce(deps, { source_id: s.source_id, adapter: greenhouseAdapter, company });
    assert.equal(first.inserted, 1);
    const second = await pollOnce(deps, { source_id: s.source_id, adapter: greenhouseAdapter, company });
    // Same upstream id → exact (or fuzzy) dedup → no new insert, novelty_count++
    assert.equal(second.inserted, 0);
    assert.equal(second.duplicates, 1);

    // Only one row in signal_candidates for this (source, external_id).
    const { rows } = await fx.pool.query<{ n: string; novelty_count: number }>(
      `select count(*)::text as n, max(novelty_count) as novelty_count
         from signal_candidates where source_id = $1`,
      [s.source_id],
    );
    assert.equal(Number(rows[0].n), 1);
    assert.equal(rows[0].novelty_count, 2);
  } finally {
    await fx.close();
  }
});

test("pollOnce: candidate that disappears from the upstream is expired + downstream signals spent + signal.expired emitted", async (t) => {
  const fx = await setupPg("poll_expire");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const s = await seed(fx.pool);
    const company = (await getTrackedCompany(fx.pool, s.company_id))!;
    let response: Response;
    const fetchImpl = (async () => response) as unknown as typeof fetch;

    // First poll: two jobs.
    response = ghJobsResponse([
      { id: 1, title: "Staff Engineer", updated_at: "2026-05-24T00:00:00Z" },
      { id: 2, title: "Senior PM", updated_at: "2026-05-24T00:00:00Z" },
    ]);
    await pollOnce(
      { pool: fx.pool, bus, embedder: createMockEmbeddingClient(), fetchImpl },
      { source_id: s.source_id, adapter: greenhouseAdapter, company },
    );

    // Second poll: only job 1 remains. Job 2 should expire.
    response = ghJobsResponse([
      { id: 1, title: "Staff Engineer", updated_at: "2026-05-24T00:00:00Z" },
    ]);
    const outcome = await pollOnce(
      { pool: fx.pool, bus, embedder: createMockEmbeddingClient(), fetchImpl },
      { source_id: s.source_id, adapter: greenhouseAdapter, company },
    );
    assert.equal(outcome.expired, 1);

    // The candidate row is flipped to expired.
    const { rows: cand } = await fx.pool.query<{ status: string }>(
      `select status from signal_candidates where source_id = $1 and external_id = '2'`,
      [s.source_id],
    );
    assert.equal(cand[0].status, "expired");

    // Downstream workspace signal flipped to 'spent'.
    const { rows: sigs } = await fx.pool.query<{ status: string }>(
      `select status::text as status from signals
        where workspace_id = $1
          and origin_candidate_id in (
            select id from signal_candidates where source_id = $2 and external_id = '2'
          )`,
      [s.workspace_id, s.source_id],
    );
    assert.equal(sigs[0].status, "spent");

    // signal.expired event emitted.
    await new Promise((r) => setImmediate(r));
    const expiredEvents = bus.published.filter((e) => e.event_type === "signal.expired");
    assert.equal(expiredEvents.length, 1);
    assert.equal(
      (expiredEvents[0].payload as { reason: string }).reason,
      "upstream_dropped",
    );
  } finally {
    await fx.close();
  }
});

test("pollOnce: adapter failure records the error on the cursor and returns without throwing", async (t) => {
  const fx = await setupPg("poll_err");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const s = await seed(fx.pool);
    const company = (await getTrackedCompany(fx.pool, s.company_id))!;
    const fetchImpl = (async () =>
      new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const outcome = await pollOnce(
      { pool: fx.pool, bus, embedder: createMockEmbeddingClient(), fetchImpl },
      { source_id: s.source_id, adapter: greenhouseAdapter, company },
    );
    assert.equal(outcome.inserted, 0);
    assert.match(outcome.error ?? "", /503/);

    const cursor = await loadCursor(fx.pool, s.source_id, s.company_id);
    assert.ok(cursor.last_error);
  } finally {
    await fx.close();
  }
});

test("pollOnce: emits one signal.ingested per workspace per new candidate", async (t) => {
  const fx = await setupPg("poll_fan");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const s = await seed(fx.pool);
    const company = (await getTrackedCompany(fx.pool, s.company_id))!;
    const fetchImpl = (async () =>
      ghJobsResponse([
        { id: 11, title: "Staff Engineer", updated_at: "2026-05-24T00:00:00Z" },
      ])) as unknown as typeof fetch;

    await pollOnce(
      { pool: fx.pool, bus, embedder: createMockEmbeddingClient(), fetchImpl },
      { source_id: s.source_id, adapter: greenhouseAdapter, company },
    );

    await until(() =>
      bus.published.filter((e) => e.event_type === "signal.ingested").length === 1,
    );
    const ev = bus.published.find((e) => e.event_type === "signal.ingested")!;
    assert.equal(ev.workspace_id, s.workspace_id);
    assert.equal((ev.payload as { kind: string }).kind, "hiring");
  } finally {
    await fx.close();
  }
});
