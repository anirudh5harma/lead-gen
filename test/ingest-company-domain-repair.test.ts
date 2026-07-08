import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { repairMatchedSignalCompanyLinksOnce } from "../core/ingest/workspace-discovery.ts";
import { projectSignalCompanyLinked } from "../core/ingest/projectors.ts";

async function seedSource(
  pool: Pool,
): Promise<{ workspace_id: string; source_id: string }> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `repair-${workspace_id.slice(0, 8)}`, "repair workspace"],
  );
  await pool.query(
    `insert into workspace_ingestion_budgets (workspace_id) values ($1)`,
    [workspace_id],
  );
  const source_id = randomUUID();
  await pool.query(
    `insert into graph_sources (id, workspace_id, kind, name, config)
     values ($1, $2, 'web_monitor', 'Product Hunt', $3::jsonb)`,
    [
      source_id,
      workspace_id,
      JSON.stringify({
        adapter: "product_hunt",
        kind: "product_launch",
        provider: "product_hunt",
      }),
    ],
  );
  return { workspace_id, source_id };
}

test("company domain repair resolves Product Hunt redirect domains", async (t) => {
  const fx = await setupPg("company_domain_ph_redirect");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const { workspace_id, source_id } = await seedSource(fx.pool);
    const signal_id = randomUUID();
    await fx.pool.query(
      `insert into signals (
         id, workspace_id, source_id, kind, title, content, url,
         freshness_at, status, properties, provenance, ingested_at
       ) values (
         $1, $2, $3, 'product_launch', $4, $5, $6,
         $7, 'matched', $8::jsonb, $9::jsonb, now()
       )`,
      [
        signal_id,
        workspace_id,
        source_id,
        "LaunchCo - turn signals into outreach",
        "LaunchCo helps GTM teams act on open-web buying signals.",
        "https://www.producthunt.com/products/launchco",
        "2026-06-12T00:00:00.000Z",
        JSON.stringify({
          structured: {
            name: "LaunchCo",
            tagline: "Turn signals into outreach",
            website: "https://www.producthunt.com/r/LAUNCHCO",
          },
        }),
        JSON.stringify({ adapter: "product_hunt", external_id: "ph-redirect-1" }),
      ],
    );

    assert.equal(
      await repairMatchedSignalCompanyLinksOnce(
        { pool: fx.pool, bus },
        {
          workspace_id,
          limit: 5,
          fetchImpl: async () =>
            ({ url: "https://www.launchco.ai/?ref=producthunt" }) as Response,
        },
      ),
      1,
    );
    const event = bus.published.find((candidate) =>
      candidate.event_type === "signal.company.linked"
    );
    assert.equal(event?.payload.company.domain, "launchco.ai");
    await projectSignalCompanyLinked(fx.pool, workspace_id, event!.payload, event!.id);

    const { rows } = await fx.pool.query<{
      related_company_id: string | null;
      company_domain: string | null;
    }>(
      `select s.related_company_id::text as related_company_id,
              gc.domain as company_domain
         from signals s
         left join graph_companies gc on gc.id = s.related_company_id
        where s.workspace_id = $1
          and s.id = $2`,
      [workspace_id, signal_id],
    );
    assert.ok(rows[0]?.related_company_id);
    assert.equal(rows[0]?.company_domain, "launchco.ai");
  } finally {
    await fx.close();
  }
});

test("company domain repair backfills already-linked graph companies", async (t) => {
  const fx = await setupPg("company_domain_linked");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  try {
    const { workspace_id, source_id } = await seedSource(fx.pool);
    const company_id = randomUUID();
    const signal_id = randomUUID();
    await fx.pool.query(
      `insert into graph_companies (id, workspace_id, name, description)
       values ($1, $2, 'LaunchCo', 'LaunchCo helps GTM teams act on signals.')`,
      [company_id, workspace_id],
    );
    await fx.pool.query(
      `insert into signals (
         id, workspace_id, source_id, kind, title, content, url,
         freshness_at, related_company_id, status, properties, provenance, ingested_at
       ) values (
         $1, $2, $3, 'product_launch', $4, $5, $6,
         $7, $8, 'matched', $9::jsonb, $10::jsonb, now()
       )`,
      [
        signal_id,
        workspace_id,
        source_id,
        "LaunchCo - turn signals into outreach",
        "LaunchCo helps GTM teams act on open-web buying signals.",
        "https://www.producthunt.com/products/launchco",
        "2026-06-12T00:00:00.000Z",
        company_id,
        JSON.stringify({
          structured: {
            name: "LaunchCo",
            website: "https://www.producthunt.com/r/LAUNCHCO",
          },
        }),
        JSON.stringify({ adapter: "product_hunt", external_id: "ph-linked-domain-1" }),
      ],
    );

    assert.equal(
      await repairMatchedSignalCompanyLinksOnce(
        { pool: fx.pool, bus },
        {
          workspace_id,
          limit: 5,
          fetchImpl: async () => ({ url: "https://launchco.ai/" }) as Response,
        },
      ),
      1,
    );
    const event = bus.published.find((candidate) =>
      candidate.event_type === "signal.company.linked"
    );
    assert.equal(event?.payload.company.domain, "launchco.ai");
    await projectSignalCompanyLinked(fx.pool, workspace_id, event!.payload, event!.id);

    const { rows } = await fx.pool.query<{
      related_company_id: string | null;
      company_domain: string | null;
    }>(
      `select s.related_company_id::text as related_company_id,
              gc.domain as company_domain
         from signals s
         join graph_companies gc on gc.id = s.related_company_id
        where s.workspace_id = $1
          and s.id = $2`,
      [workspace_id, signal_id],
    );
    assert.equal(rows[0]?.related_company_id, company_id);
    assert.equal(rows[0]?.company_domain, "launchco.ai");
  } finally {
    await fx.close();
  }
});
