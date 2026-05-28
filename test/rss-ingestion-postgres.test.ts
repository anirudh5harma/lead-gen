import { test } from "node:test";
import assert from "node:assert/strict";
import { setupPg, until } from "./_pg.ts";
import { upsertSource } from "../core/graph/nodes/sources.ts";
import {
  createRssSignalIngestionWorkflow,
  RSS_SIGNAL_INGESTION_WORKFLOW,
} from "../core/signals/index.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import { createPostgresWorkflowRuntime } from "../core/substrate/workflows/index.ts";
import { bootstrapWorkspace } from "../core/product/app.ts";

test("rss ingestion workflow: upserts source signals idempotently and emits typed events", async (t) => {
  const fx = await setupPg("rss_ingestion");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = await createPostgresEventBus({ pool: fx.pool });
  try {
    const boot = await bootstrapWorkspace(fx.pool);
    const source = await upsertSource(fx.pool, boot.workspace_id, {
      kind: "rss",
      name: "Launch Feed",
      config: {
        url: "https://example.com/feed.xml",
        kind: "product_launch",
        limit: 10,
      },
    });

    const runtime = createPostgresWorkflowRuntime({ pool: fx.pool, bus });
    runtime.register(
      createRssSignalIngestionWorkflow({
        pool: fx.pool,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          async text() {
            return `<?xml version="1.0"?>
              <rss>
                <channel>
                  <item>
                    <title>Acme launched a workflow engine</title>
                    <link>https://example.com/acme-workflow</link>
                    <description>Acme shipped a durable workflow launch.</description>
                    <pubDate>Mon, 25 May 2026 10:00:00 GMT</pubDate>
                  </item>
                </channel>
              </rss>`;
          },
        }),
      }),
    );

    await runtime.start({
      workspace_id: boot.workspace_id,
      workflow_name: RSS_SIGNAL_INGESTION_WORKFLOW,
      idempotency_key: `rss-test:${source.id}:1`,
      input: {
        workspace_id: boot.workspace_id,
        source_id: source.id,
      },
    });

    const first = await until(async () => {
      const { rows } = await fx.pool.query<{
        status: string;
        output: { inserted?: number; updated?: number } | null;
      }>(
        `select status, output
           from workflow_runs
          where idempotency_key = $1`,
        [`rss-test:${source.id}:1`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });
    assert.equal(first.output?.inserted, 1);
    assert.equal(first.output?.updated, 0);

    const ingested = await fx.pool.query<{
      id: string;
      kind: string;
      source_id: string;
      title: string;
    }>(
      `select id, kind, source_id, title
         from signals
        where workspace_id = $1
          and source_id = $2`,
      [boot.workspace_id, source.id],
    );
    assert.equal(ingested.rowCount, 1);
    assert.equal(ingested.rows[0].kind, "product_launch");
    assert.equal(ingested.rows[0].title, "Acme launched a workflow engine");

    const eventCount = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from events
        where workspace_id = $1
          and event_type = 'signal.ingested'
          and payload->>'signal_id' = $2`,
      [boot.workspace_id, ingested.rows[0].id],
    );
    assert.equal(Number(eventCount.rows[0].count), 1);

    const edge = await fx.pool.query<{ count: string }>(
      `select count(*)::text as count
         from graph_edges
        where workspace_id = $1
          and from_node_type = 'source'
          and from_node_id = $2
          and edge_type = 'emitted'
          and to_node_type = 'signal'
          and to_node_id = $3`,
      [boot.workspace_id, source.id, ingested.rows[0].id],
    );
    assert.equal(Number(edge.rows[0].count), 1);

    await runtime.start({
      workspace_id: boot.workspace_id,
      workflow_name: RSS_SIGNAL_INGESTION_WORKFLOW,
      idempotency_key: `rss-test:${source.id}:2`,
      input: {
        workspace_id: boot.workspace_id,
        source_id: source.id,
      },
    });

    const second = await until(async () => {
      const { rows } = await fx.pool.query<{
        status: string;
        output: { inserted?: number; updated?: number } | null;
      }>(
        `select status, output
           from workflow_runs
          where idempotency_key = $1`,
        [`rss-test:${source.id}:2`],
      );
      return rows[0]?.status === "completed" ? rows[0] : null;
    });
    assert.equal(second.output?.inserted, 0);
    assert.equal(second.output?.updated, 1);

    const totals = await fx.pool.query<{ signals: string; events: string }>(
      `select
         (select count(*)::text
            from signals
           where workspace_id = $1 and source_id = $2) as signals,
         (select count(*)::text
            from events
           where workspace_id = $1
             and event_type = 'signal.ingested'
             and payload->>'signal_id' = $3) as events`,
      [boot.workspace_id, source.id, ingested.rows[0].id],
    );
    assert.equal(Number(totals.rows[0].signals), 1);
    assert.equal(Number(totals.rows[0].events), 1);

    const polled = await fx.pool.query<{ last_polled_at: Date | null }>(
      `select last_polled_at from graph_sources where id = $1`,
      [source.id],
    );
    assert.ok(polled.rows[0].last_polled_at);
  } finally {
    await bus.close();
    await fx.close();
  }
});
