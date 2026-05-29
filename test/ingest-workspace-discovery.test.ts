import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { createMockEmbeddingClient } from "../core/ingest/embeddings.ts";
import { discoverWorkspaceSignalOnce } from "../core/ingest/workspace-discovery.ts";
import { registerSignalProjectors } from "../core/ingest/projectors.ts";
import {
  projectPendingProductEventsOnce,
  resetProductEngineForTests,
} from "../core/product/app.ts";
import { resetPool, setPool } from "../core/substrate/storage/index.ts";
import { POST as signalWebhookPost } from "../app/api/webhooks/signals/route.ts";

async function seedPushSource(pool: Pool): Promise<{
  workspace_id: string;
  source_id: string;
}> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `push-${workspace_id.slice(0, 8)}`, "push workspace"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
    [workspace_id],
  );
  const source_id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name, config)
     values ($1, $2, 'web_monitor', 'Push source', $3::jsonb)`,
    [
      source_id,
      workspace_id,
      JSON.stringify({ adapter: "webhook", kind: "hiring" }),
    ],
  );
  return { workspace_id, source_id };
}

test("workspace discovery: push item emits signal.discovered and materializes once", async (t) => {
  const fx = await setupPg("wsp_push");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  await registerSignalProjectors({ pool: fx.pool, bus });
  try {
    const { workspace_id, source_id } = await seedPushSource(fx.pool);
    const deps = {
      pool: fx.pool,
      bus,
      embedder: createMockEmbeddingClient(),
    };
    const first = await discoverWorkspaceSignalOnce(deps, {
      workspace_id,
      source_id,
      external_id: "push-evt-1",
      title: "Acme is hiring founding AEs",
      content: "Acme opened two founding AE roles in New York.",
      url: "https://example.com/acme-ae",
      freshness_at: "2026-05-29T00:00:00.000Z",
      structured: { function: "sales", seniority: "founding" },
      provenance: { provider: "unit-test" },
    });
    assert.equal(first.outcome, "created");

    await until(() =>
      bus.published.some((event) => event.event_type === "signal.ingested"),
    );
    const { rows } = await fx.pool.query<{
      id: string;
      kind: string;
      title: string;
      provenance: Record<string, unknown>;
      properties: { structured?: Record<string, unknown> };
    }>(
      `select id, kind::text as kind, title, provenance, properties
         from signals
        where workspace_id = $1 and source_id = $2`,
      [workspace_id, source_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.signal_id);
    assert.equal(rows[0].kind, "hiring");
    assert.equal(rows[0].provenance.adapter, "webhook");
    assert.equal(rows[0].provenance.external_id, "push-evt-1");
    assert.deepEqual(rows[0].properties.structured, {
      function: "sales",
      seniority: "founding",
    });

    const second = await discoverWorkspaceSignalOnce(deps, {
      workspace_id,
      source_id,
      external_id: "push-evt-1",
      title: "Acme is hiring founding AEs",
      freshness_at: "2026-05-29T00:00:00.000Z",
    });
    assert.equal(second.outcome, "skipped:dedup");
    assert.equal(second.signal_id, first.signal_id);
  } finally {
    await fx.close();
  }
});

test("signal webhook route: authenticated push ingress emits and projects signal discovery", async (t) => {
  const fx = await setupPg("signal_webhook");
  if (!fx) return t.skip("DATABASE_URL not set");

  const priorSecret = process.env.SIGNAL_WEBHOOK_SECRET;
  const priorSubstrate = process.env.BOMBSELL_SUBSTRATE;
  const priorNodeEnv = process.env.NODE_ENV;
  const priorOpenAi = process.env.OPENAI_API_KEY;
  const secret = "signal-webhook-secret";
  process.env.SIGNAL_WEBHOOK_SECRET = secret;
  process.env.BOMBSELL_SUBSTRATE = "postgres";
  process.env.NODE_ENV = "test";
  delete process.env.OPENAI_API_KEY;
  setPool(fx.pool);
  try {
    const { source_id } = await seedPushSource(fx.pool);
    const rejected = await signalWebhookPost(
      new Request("http://localhost/api/webhooks/signals", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          source_id,
          external_id: "provider-evt-rejected",
          title: "Should not land",
        }),
      }),
    );
    assert.equal(rejected.status, 401);

    const req = new Request("http://localhost/api/webhooks/signals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source_id,
        external_id: "provider-evt-1",
        title: "Beta hired a VP Sales",
        signal_kind: "hiring",
        freshness_at: "2026-05-29T12:00:00.000Z",
        structured: { function: "sales", seniority: "vp" },
      }),
    });

    const response = await signalWebhookPost(req);
    assert.equal(response.status, 202);
    const body = await response.json() as {
      received: number;
      results: Array<{ signal_id?: string; event_id?: string; outcome: string }>;
    };
    assert.equal(body.received, 1);
    assert.equal(body.results[0].outcome, "created");
    assert.ok(body.results[0].signal_id);
    assert.ok(body.results[0].event_id);

    await projectPendingProductEventsOnce({ limit: 10, leaseOwner: "signal-webhook-test" });
    const { rows } = await fx.pool.query<{
      id: string;
      title: string;
      provenance: Record<string, unknown>;
    }>(
      `select id, title, provenance from signals where id = $1`,
      [body.results[0].signal_id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Beta hired a VP Sales");
    assert.equal(rows[0].provenance.adapter, "webhook");
    assert.equal(rows[0].provenance.external_id, "provider-evt-1");
  } finally {
    if (priorSecret === undefined) delete process.env.SIGNAL_WEBHOOK_SECRET;
    else process.env.SIGNAL_WEBHOOK_SECRET = priorSecret;
    if (priorSubstrate === undefined) delete process.env.BOMBSELL_SUBSTRATE;
    else process.env.BOMBSELL_SUBSTRATE = priorSubstrate;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorOpenAi;
    await resetProductEngineForTests();
    await fx.close();
    await resetPool();
  }
});

test("signal webhook route: reports unconfigured when database or secret is absent", async () => {
  const priorSecret = process.env.SIGNAL_WEBHOOK_SECRET;
  process.env.SIGNAL_WEBHOOK_SECRET = "signal-webhook-secret";
  try {
    const response = await signalWebhookPost(
      new Request("http://localhost/api/webhooks/signals", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
        body: JSON.stringify({
          source_id: randomUUID(),
          external_id: "evt-1",
          title: "Bad",
        }),
      }),
    );
    assert.equal(response.status, process.env.DATABASE_URL ? 401 : 503);
  } finally {
    if (priorSecret === undefined) delete process.env.SIGNAL_WEBHOOK_SECRET;
    else process.env.SIGNAL_WEBHOOK_SECRET = priorSecret;
    await resetPool();
  }
});
