import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import {
  SIGNAL_KIND_INTENT_CONFIG,
  computeAccountCompositeIntentScore,
  decayedWeight,
  discoverWorkspaceSignalOnce,
  listAccountsByCompositeIntent,
  registerSignalProjectors,
} from "../core/ingest/index.ts";
import { createMockEmbeddingClient } from "../core/ingest/embeddings.ts";
import { setupPg, until } from "./_pg.ts";

test("account intent scoring: decay is monotonic as signals age", () => {
  const fresh = decayedWeight(1, 0, 24);
  const half = decayedWeight(1, 24, 24);
  const old = decayedWeight(1, 48, 24);

  assert.ok(fresh > half);
  assert.ok(half > old);
});

test("account intent scoring: stacked signals outrank a single strong signal", () => {
  const now = new Date("2026-06-21T12:00:00.000Z");
  const single = computeAccountCompositeIntentScore([{
    kind: "funding",
    freshness_at: "2026-06-20T12:00:00.000Z",
    match_score: 0.92,
  }], now);
  const stacked = computeAccountCompositeIntentScore([
    {
      kind: "funding",
      freshness_at: "2026-06-20T12:00:00.000Z",
      match_score: 0.92,
    },
    {
      kind: "hiring",
      freshness_at: "2026-06-21T06:00:00.000Z",
      match_score: 0.81,
    },
  ], now);

  assert.ok(stacked.composite_score > single.composite_score);
});

test("account intent scoring: GTM-priority kinds outrank soft mentions", () => {
  assert.ok(
    SIGNAL_KIND_INTENT_CONFIG.funding.base_strength >
      SIGNAL_KIND_INTENT_CONFIG.press_mention.base_strength,
  );
  assert.ok(
    SIGNAL_KIND_INTENT_CONFIG.leadership_change.base_strength >
      SIGNAL_KIND_INTENT_CONFIG.podcast_mention.base_strength,
  );
  assert.ok(
    SIGNAL_KIND_INTENT_CONFIG.hiring.base_strength >
      SIGNAL_KIND_INTENT_CONFIG.press_mention.base_strength,
  );
});

test("account intent projector: resolves one company node and ranks stacked accounts", async (t) => {
  const fx = await setupPg("account_intent");
  if (!fx) return t.skip("DATABASE_URL not set");

  const bus = createInMemoryEventBus();
  await registerSignalProjectors({ pool: fx.pool, bus });
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, `intent-${workspace_id.slice(0, 8)}`, "intent workspace"],
    );
    await fx.pool.query(
      `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
      [workspace_id],
    );

    const acmeProductHuntSource = await seedSource(
      fx.pool,
      workspace_id,
      "product_hunt",
      "product_launch",
      "Product Hunt",
    );
    const acmeWebhookSource = await seedSource(
      fx.pool,
      workspace_id,
      "webhook",
      "hiring",
      "Webhook",
    );
    const betaWebhookSource = await seedSource(
      fx.pool,
      workspace_id,
      "webhook",
      "funding",
      "Webhook 2",
    );

    const deps = {
      pool: fx.pool,
      bus,
      embedder: createMockEmbeddingClient(),
    };

    const acmeLaunch = await discoverWorkspaceSignalOnce(deps, {
      workspace_id,
      source_id: acmeProductHuntSource,
      external_id: "acme-launch-1",
      title: "Acme AI - outbound workflow launch",
      content: "Acme launched a workflow engine for revenue teams.",
      url: "https://www.producthunt.com/posts/acme-ai",
      freshness_at: "2026-06-20T08:00:00.000Z",
      structured: {
        name: "Acme AI",
        website: "https://blog.acme.ai/launch/workflow",
        tagline: "Revenue workflow engine",
      },
    });
    const acmeHiring = await discoverWorkspaceSignalOnce(deps, {
      workspace_id,
      source_id: acmeWebhookSource,
      external_id: "acme-hiring-1",
      title: "Acme AI hired a VP Revenue",
      content: "Acme AI opened a VP Revenue search and GTM hiring sprint.",
      url: "https://careers.acme.ai/jobs/vp-revenue",
      freshness_at: "2026-06-21T04:00:00.000Z",
      structured: {
        company: {
          name: "Acme AI",
          domain: "https://www.acme.ai",
          description: "Revenue workflow engine",
        },
      },
    });
    const betaFunding = await discoverWorkspaceSignalOnce(deps, {
      workspace_id,
      source_id: betaWebhookSource,
      external_id: "beta-funding-1",
      title: "Beta Systems raised a seed round",
      content: "Beta Systems raised fresh capital for GTM expansion.",
      url: "https://www.beta.systems/blog/funding",
      freshness_at: "2026-06-20T18:00:00.000Z",
      structured: {
        company: {
          name: "Beta Systems",
          domain: "https://news.beta.systems/funding",
        },
      },
    });

    assert.equal(acmeLaunch.outcome, "created");
    assert.equal(acmeHiring.outcome, "created");
    assert.equal(betaFunding.outcome, "created");

    const updates: Array<{
      company_id: string;
      composite_score: number;
      live_signal_count: number;
    }> = [];
    await bus.subscribe("account.intent.updated", async (event) => {
      updates.push(event.payload as {
        company_id: string;
        composite_score: number;
        live_signal_count: number;
      });
    });

    const acmeIcp = randomUUID();
    const betaIcp = randomUUID();
    await bus.publish({
      workspace_id,
      event_type: "signal.classification.completed",
      source: "system",
      producer_ref: "test:account-intent",
      idempotency_key: "classify:acme-launch-1",
      payload: {
        signal_id: acmeLaunch.signal_id,
        kind: "product_launch",
        disposition: "matched",
        match_score: 0.76,
        match_reason: "Product launch with revenue workflow relevance.",
        audience_hint: { icp_segment: acmeIcp, confidence: 0.76 },
        matches: [{ icp_segment: acmeIcp, match_score: 0.76, reason: "launch" }],
      },
    });
    await bus.publish({
      workspace_id,
      event_type: "signal.classification.completed",
      source: "system",
      producer_ref: "test:account-intent",
      idempotency_key: "classify:acme-hiring-1",
      payload: {
        signal_id: acmeHiring.signal_id,
        kind: "hiring",
        disposition: "matched",
        match_score: 0.84,
        match_reason: "Leadership + GTM hiring surge.",
        audience_hint: { icp_segment: acmeIcp, confidence: 0.84 },
        matches: [{ icp_segment: acmeIcp, match_score: 0.84, reason: "hiring" }],
      },
    });
    await bus.publish({
      workspace_id,
      event_type: "signal.classification.completed",
      source: "system",
      producer_ref: "test:account-intent",
      idempotency_key: "classify:beta-funding-1",
      payload: {
        signal_id: betaFunding.signal_id,
        kind: "funding",
        disposition: "matched",
        match_score: 0.88,
        match_reason: "Funding with direct GTM expansion relevance.",
        audience_hint: { icp_segment: betaIcp, confidence: 0.88 },
        matches: [{ icp_segment: betaIcp, match_score: 0.88, reason: "funding" }],
      },
    });

    await until(() => updates.length >= 3, { timeout: 5_000 });

    const companies = await fx.pool.query<{
      name: string;
      domain: string | null;
      signal_count: string;
    }>(
      `select gc.name,
              gc.domain::text as domain,
              count(s.id)::text as signal_count
         from graph_companies gc
         left join signals s
           on s.workspace_id = gc.workspace_id
          and s.related_company_id = gc.id
        where gc.workspace_id = $1
        group by gc.id
        order by gc.name asc`,
      [workspace_id],
    );
    const acmeCompanies = companies.rows.filter((row) => row.domain === "acme.ai");
    assert.equal(acmeCompanies.length, 1);
    assert.equal(acmeCompanies[0].signal_count, "2");

    const ranked = await listAccountsByCompositeIntent(fx.pool, workspace_id, {
      now: new Date("2026-06-21T12:00:00.000Z"),
      limit: 10,
    });
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0]?.company_name, "Acme AI");
    assert.equal(ranked[0]?.normalized_domain, "acme.ai");
    assert.equal(ranked[0]?.live_signal_count, 2);
    assert.equal(ranked[1]?.company_name, "Beta Systems");
    assert.equal(ranked[1]?.normalized_domain, "beta.systems");
    assert.ok((ranked[0]?.composite_score ?? 0) > (ranked[1]?.composite_score ?? 0));

    assert.ok(
      updates.some((event) =>
        event.live_signal_count === 2 && event.composite_score > 0
      ),
    );
  } finally {
    await fx.close();
  }
});

async function seedSource(
  pool: { query: Pool["query"] },
  workspace_id: string,
  adapter: string,
  kind: string,
  name: string,
): Promise<string> {
  const source_id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name, config)
     values ($1, $2, 'web_monitor', $3, $4::jsonb)`,
    [
      source_id,
      workspace_id,
      name,
      JSON.stringify({ adapter, kind, provider: adapter }),
    ],
  );
  return source_id;
}
