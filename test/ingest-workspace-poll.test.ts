import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { createMockEmbeddingClient } from "../core/ingest/embeddings.ts";
import {
  buildNextCursor,
  maxItemsPerPoll,
  selectNextWorkspacePollItems,
  workspacePollOnce,
} from "../core/ingest/workspace-poll.ts";
import { parseFeed } from "../core/ingest/adapters/rss.ts";
import { registerSignalProjectors } from "../core/ingest/projectors.ts";

interface Seeded {
  workspace_id: string;
  source_id: string;
}

async function seed(pool: Pool, kind: string, config: Record<string, unknown>): Promise<Seeded> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
    [workspace_id],
  );
  const source_id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name, config)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [source_id, workspace_id, kind, `${kind} test`, JSON.stringify(config)],
  );
  return { workspace_id, source_id };
}

function rssFetch(xml: string): typeof fetch {
  return (async () =>
    new Response(xml, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    })) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const RSS_XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <item>
      <guid>https://example.com/funding-1</guid>
      <title>Acme raises Series A</title>
      <link>https://example.com/funding-1</link>
      <description>Acme just closed a $20M Series A.</description>
      <pubDate>Sun, 25 May 2026 12:00:00 GMT</pubDate>
    </item>
    <item>
      <guid>https://example.com/launch-1</guid>
      <title>New product launches</title>
      <link>https://example.com/launch-1</link>
      <description>A new dev tool is here.</description>
      <pubDate>Mon, 26 May 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

test("workspace poll batching: advances through feed items with cursor seen ids", () => {
  const items = Array.from({ length: 5 }, (_, i) => ({
    external_id: `item-${i + 1}`,
    title: `Item ${i + 1}`,
    freshness_at: "2026-06-02T00:00:00.000Z",
  }));

  const first = selectNextWorkspacePollItems(items, {}, 2);
  assert.deepEqual(first.map((item) => item.external_id), ["item-1", "item-2"]);

  const cursor = buildNextCursor({}, { count: 5 }, items, first);
  assert.deepEqual(cursor.seen_external_ids, ["item-1", "item-2"]);
  assert.equal(cursor.selected_count, 2);
  assert.equal(cursor.polled_count, 5);

  const second = selectNextWorkspacePollItems(items, cursor, 2);
  assert.deepEqual(second.map((item) => item.external_id), ["item-3", "item-4"]);
});

test("workspace poll batching: bounds configured batch size", () => {
  assert.equal(maxItemsPerPoll({}), 3);
  assert.equal(maxItemsPerPoll({ max_items_per_poll: "3" }), 3);
  assert.equal(maxItemsPerPoll({ max_items_per_poll: 500 }), 10);
  assert.equal(maxItemsPerPoll({ max_items_per_poll: -1 }), 3);
});

test("RSS parse: malformed item dates fall back instead of failing the feed", async () => {
  const items = await parseFeed(`<?xml version="1.0"?>
  <rss version="2.0">
    <channel>
      <item>
        <guid>bad-date-1</guid>
        <title>Acme announces expansion</title>
        <link>https://example.com/bad-date-1</link>
        <description>Acme opened a new office.</description>
        <pubDate>not a real date</pubDate>
      </item>
    </channel>
  </rss>`);

  assert.equal(items.length, 1);
  assert.equal(items[0].external_id, "bad-date-1");
  assert.equal(Number.isNaN(Date.parse(items[0].freshness_at)), false);
});

async function createProjectingBus(pool: Pool) {
  const bus = createInMemoryEventBus();
  await registerSignalProjectors({ pool, bus });
  return bus;
}

// ─── workspacePollOnce: RSS happy path ────────────────────────────────────

test("workspace poll: RSS adapter inserts signals + emits signal.ingested", async (t) => {
  const fx = await setupPg("wsp_rss");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "rss", {
      url: "https://example.com/feed.xml",
    });
    const summary = await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl: rssFetch(RSS_XML),
      },
      { workspace_id, source_id },
    );
    assert.equal(summary.inserted, 2);
    assert.equal(summary.duplicates, 0);

    await until(() =>
      bus.published.filter((e) => e.event_type === "signal.ingested").length === 2,
    );
    const { rows: sigs } = await fx.pool.query<{ kind: string | null; title: string; provenance: { external_id: string } }>(
      `select kind::text as kind, title, provenance from signals
        where workspace_id = $1 order by freshness_at asc`,
      [workspace_id],
    );
    assert.equal(sigs.length, 2);
    assert.equal(sigs[0].provenance.external_id, "https://example.com/funding-1");

    const events = bus.published.filter((e) => e.event_type === "signal.ingested");
    assert.equal(events.length, 2);
  } finally {
    await fx.close();
  }
});

test("workspace poll: re-polling dedups by (workspace, source, external_id)", async (t) => {
  const fx = await setupPg("wsp_dedup");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "rss", {
      url: "https://example.com/feed.xml",
    });
    const deps = {
      pool: fx.pool,
      bus,
      embedder: createMockEmbeddingClient(),
      fetchImpl: rssFetch(RSS_XML),
    };
    const first = await workspacePollOnce(deps, { workspace_id, source_id });
    assert.equal(first.inserted, 2);
    await until(() =>
      bus.published.filter((e) => e.event_type === "signal.ingested").length === 2,
    );
    const second = await workspacePollOnce(deps, { workspace_id, source_id });
    assert.equal(second.inserted, 0);
    assert.equal(second.duplicates, 0);

    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from signals where workspace_id = $1`,
      [workspace_id],
    );
    assert.equal(Number(rows[0].n), 2);
  } finally {
    await fx.close();
  }
});

test("workspace poll: ICP must_haves filter skips off-target items", async (t) => {
  const fx = await setupPg("wsp_icp");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "rss", {
      url: "https://example.com/feed.xml",
    });
    // ICP that demands kind=hiring; RSS items have null kind → filtered.
    await fx.pool.query(
      `insert into workspace_icps (workspace_id, name, description, must_haves)
       values ($1, 'hiring-only', 'x', $2::jsonb)`,
      [workspace_id, JSON.stringify([{ field: "kind", op: "eq", value: "hiring" }])],
    );
    const summary = await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl: rssFetch(RSS_XML),
      },
      { workspace_id, source_id },
    );
    assert.equal(summary.inserted, 0);
    assert.equal(summary.skipped_must_haves, 2);
  } finally {
    await fx.close();
  }
});

test("workspace poll: daily cap → skipped:budget + overflow audit", async (t) => {
  const fx = await setupPg("wsp_budget");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "rss", {
      url: "https://example.com/feed.xml",
    });
    // Force the cap to zero.
    await fx.pool.query(
      `update workspace_ingestion_budgets set daily_candidate_cap = 0 where workspace_id = $1`,
      [workspace_id],
    );
    const summary = await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl: rssFetch(RSS_XML),
      },
      { workspace_id, source_id },
    );
    assert.equal(summary.inserted, 0);
    assert.equal(summary.skipped_budget, 2);
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from signal_overflow where workspace_id = $1`,
      [workspace_id],
    );
    assert.equal(Number(rows[0].n), 2);
  } finally {
    await fx.close();
  }
});

test("workspace poll: source daily call cap prevents paid adapter fetch", async (t) => {
  const fx = await setupPg("wsp_call_cap");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  const prior = process.env.X_API_BEARER_TOKEN;
  process.env.X_API_BEARER_TOKEN = "x-token";
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "other", {
      adapter: "x_search",
      provider: "x_official",
      query: '"Apollo alternative"',
      max_daily_calls: 1,
    });
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch;
    const deps = {
      pool: fx.pool,
      bus,
      embedder: createMockEmbeddingClient(),
      fetchImpl,
    };
    const first = await workspacePollOnce(deps, { workspace_id, source_id });
    assert.equal(first.error, undefined);
    assert.equal(calls, 1);

    const second = await workspacePollOnce(deps, { workspace_id, source_id });
    assert.equal(second.inserted, 0);
    assert.equal(second.skipped_budget, 1);
    assert.equal(calls, 1);

    const { rows } = await fx.pool.query<{
      reason: string;
      payload: Record<string, unknown>;
    }>(
      `select reason, payload
         from signal_overflow
        where workspace_id = $1 and source_id = $2`,
      [workspace_id, source_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reason, "source_daily_call_cap_reached");
    assert.equal(rows[0].payload.provider, "x_official");
  } finally {
    if (prior === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = prior;
    await fx.close();
  }
});

test("workspace poll: adapter failure stores last_error on the config", async (t) => {
  const fx = await setupPg("wsp_err");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "rss", {
      url: "https://example.com/feed.xml",
    });
    const fetchImpl = (async () =>
      new Response("nope", { status: 502 })) as unknown as typeof fetch;
    const summary = await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl,
      },
      { workspace_id, source_id },
    );
    assert.match(summary.error ?? "", /502/);
    const { rows } = await fx.pool.query<{ last_error: { message: string } | null }>(
      `select last_error from workspace_source_configs where workspace_id = $1 and source_id = $2`,
      [workspace_id, source_id],
    );
    assert.ok(rows[0].last_error);
    assert.match(String(rows[0].last_error?.message ?? ""), /502/);
  } finally {
    await fx.close();
  }
});

test("workspace poll: kindHint='product_launch' is preserved on the signal", async (t) => {
  const fx = await setupPg("wsp_kind");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "product_hunt", {
      token: "t-1",
      limit: 1,
    });
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: {
            posts: {
              edges: [
                {
                  node: {
                    id: "ph-1",
                    name: "Bonsai",
                    tagline: "Tiny tree",
                    createdAt: "2026-05-25T12:00:00Z",
                  },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const summary = await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl,
      },
      { workspace_id, source_id },
    );
    assert.equal(summary.inserted, 1);
    await until(() =>
      bus.published.some((e) => e.event_type === "signal.ingested"),
    );
    const { rows } = await fx.pool.query<{ kind: string }>(
      `select kind::text as kind from signals where workspace_id = $1`,
      [workspace_id],
    );
    assert.equal(rows[0].kind, "product_launch");
  } finally {
    await fx.close();
  }
});

test("workspace poll: official ATS sources materialize credibility, buying intent, and timing", async (t) => {
  const fx = await setupPg("wsp_official_ats");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "job_board", {
      adapter: "greenhouse",
      board_slug: "acme",
      company_name: "Acme",
      company_domain: "acme.example",
      signal_kind: "hiring",
      source_tier: "official",
      source_authority: 0.95,
      source_reason: "autodiscovered_careers_ats",
      max_items_per_poll: 10,
    });
    const now = new Date().toISOString();
    const fetchImpl = (async (url: string) => {
      assert.equal(
        url,
        "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true",
      );
      return jsonResponse({
        jobs: [
          {
            id: 101,
            title: "Founding VP Sales",
            content: "<p>Lead GTM expansion after our Series A.</p>",
            absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
            updated_at: now,
            location: { name: "New York, NY" },
            departments: [{ id: 1, name: "Sales" }],
          },
        ],
      });
    }) as unknown as typeof fetch;

    const summary = await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl,
      },
      { workspace_id, source_id },
    );

    assert.equal(summary.inserted, 1);
    await until(() =>
      bus.published.some((event) => event.event_type === "signal.ingested"),
    );
    const { rows } = await fx.pool.query<{
      kind: string;
      properties: Record<string, unknown>;
      provenance: Record<string, unknown>;
    }>(
      `select kind::text as kind, properties, provenance
         from signals
        where workspace_id = $1 and source_id = $2`,
      [workspace_id, source_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "hiring");
    assert.equal(rows[0].properties.source_tier, "official");
    assert.equal(rows[0].properties.source_authority, 0.95);
    assert.equal(
      (rows[0].properties.source_credibility as { tier?: string }).tier,
      "official",
    );
    assert.equal(
      (rows[0].properties.buying_intent as { level?: string }).level,
      "high",
    );
    assert.equal(
      (rows[0].properties.timing as { conversion_window?: string }).conversion_window,
      "now",
    );
    assert.equal(rows[0].provenance.source_tier, "official");
    assert.equal(rows[0].provenance.quality_model, "signal_quality.v1");
  } finally {
    await fx.close();
  }
});

test("workspace poll: emits signal.ingested with source_id set on the payload", async (t) => {
  const fx = await setupPg("wsp_emit");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createProjectingBus(fx.pool);
  try {
    const { workspace_id, source_id } = await seed(fx.pool, "rss", {
      url: "https://example.com/feed.xml",
    });
    await workspacePollOnce(
      {
        pool: fx.pool,
        bus,
        embedder: createMockEmbeddingClient(),
        fetchImpl: rssFetch(RSS_XML),
      },
      { workspace_id, source_id },
    );
    await until(() =>
      bus.published.filter((e) => e.event_type === "signal.ingested").length === 2,
    );
    const events = bus.published.filter((e) => e.event_type === "signal.ingested");
    for (const ev of events) {
      assert.equal(ev.workspace_id, workspace_id);
      assert.equal((ev.payload as { source_id: string }).source_id, source_id);
    }
  } finally {
    await fx.close();
  }
});
