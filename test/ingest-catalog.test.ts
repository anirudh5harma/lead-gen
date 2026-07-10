import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  addCompaniesByFilter,
  addCompanyExplicit,
  findTrackedByDomain,
  findWorkspacesTrackingCompany,
  getTrackedCompany,
  listCatalogForAdapter,
  listWorkspaceCompanies,
  removeCompany,
  upsertTrackedCompany,
} from "../core/ingest/catalog.ts";

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "ws"],
  );
  return ws;
}

test("catalog: upsert by domain merges on conflict", async (t) => {
  const fx = await setupPg("cat_upsert");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const a = await upsertTrackedCompany(fx.pool, {
      name: "Stripe",
      domain: "stripe.com",
      industry: "fintech",
      greenhouse_id: "stripe",
    });
    const b = await upsertTrackedCompany(fx.pool, {
      name: "Stripe Inc",
      domain: "stripe.com",
      size_bucket: "500+",
    });
    assert.equal(a.id, b.id);
    assert.equal(b.name, "Stripe Inc");
    assert.equal(b.industry, "fintech");
    assert.equal(b.greenhouse_id, "stripe");
    assert.equal(b.size_bucket, "500+");
  } finally {
    await fx.close();
  }
});

test("catalog: upsert without domain dedupes by lower(name)", async (t) => {
  const fx = await setupPg("cat_nodomain");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const a = await upsertTrackedCompany(fx.pool, { name: "Stealth Co" });
    const b = await upsertTrackedCompany(fx.pool, { name: "stealth co" });
    assert.equal(a.id, b.id);
  } finally {
    await fx.close();
  }
});

test("catalog: findTrackedByDomain + getTrackedCompany", async (t) => {
  const fx = await setupPg("cat_find");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Acme",
      domain: "acme.test",
    });
    const byDomain = await findTrackedByDomain(fx.pool, "acme.test");
    assert.equal(byDomain?.id, co.id);
    const byId = await getTrackedCompany(fx.pool, co.id);
    assert.equal(byId?.name, "Acme");
  } finally {
    await fx.close();
  }
});

test("catalog: normalized domains collapse subdomains for tracked companies", async (t) => {
  const fx = await setupPg("cat_norm");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const first = await upsertTrackedCompany(fx.pool, {
      name: "Acme",
      domain: "https://careers.acme.co.uk/jobs/revops",
    });
    const second = await upsertTrackedCompany(fx.pool, {
      name: "Acme Inc",
      domain: "blog.acme.co.uk",
    });
    const byDomain = await findTrackedByDomain(fx.pool, "www.acme.co.uk");

    assert.equal(first.id, second.id);
    assert.equal(second.domain, "acme.co.uk");
    assert.equal(byDomain?.id, first.id);
  } finally {
    await fx.close();
  }
});

test("catalog: launch-like names fall back to the organization domain name", async (t) => {
  const fx = await setupPg("cat_launch_name");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const launch = await upsertTrackedCompany(fx.pool, {
      name: "GPT-5.6",
      domain: "https://openai.com/research",
      properties: { source: "product_hunt", kind: "product_launch" },
    });

    assert.equal(launch.name, "OpenAI");
    assert.equal(launch.domain, "openai.com");
  } finally {
    await fx.close();
  }
});

test("catalog: listCatalogForAdapter filters to companies with that ATS id", async (t) => {
  const fx = await setupPg("cat_for_adapter");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    await upsertTrackedCompany(fx.pool, {
      name: "GH Only",
      domain: "gh.test",
      greenhouse_id: "gh-only",
    });
    await upsertTrackedCompany(fx.pool, {
      name: "Lever Only",
      domain: "lever.test",
      lever_id: "lever-only",
    });
    await upsertTrackedCompany(fx.pool, {
      name: "No ATS",
      domain: "noats.test",
    });
    const gh = await listCatalogForAdapter(fx.pool, "greenhouse");
    assert.equal(gh.length, 1);
    assert.equal(gh[0].greenhouse_id, "gh-only");

    const lever = await listCatalogForAdapter(fx.pool, "lever");
    assert.equal(lever.length, 1);
    assert.equal(lever[0].lever_id, "lever-only");
  } finally {
    await fx.close();
  }
});

test("catalog: workspace opt-in (explicit) is idempotent on conflict", async (t) => {
  const fx = await setupPg("cat_explicit");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Stripe",
      domain: "stripe.test",
    });
    await addCompanyExplicit(fx.pool, ws, co.id);
    await addCompanyExplicit(fx.pool, ws, co.id); // idempotent
    const list = await listWorkspaceCompanies(fx.pool, ws);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, co.id);
  } finally {
    await fx.close();
  }
});

test("catalog: filter-based opt-in resolves and bulk-inserts", async (t) => {
  const fx = await setupPg("cat_filter");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    await upsertTrackedCompany(fx.pool, {
      name: "Stripe",
      domain: "stripe.test",
      industry: "fintech",
      size_bucket: "500+",
    });
    await upsertTrackedCompany(fx.pool, {
      name: "Plaid",
      domain: "plaid.test",
      industry: "fintech",
      size_bucket: "201-500",
    });
    await upsertTrackedCompany(fx.pool, {
      name: "Anthropic",
      domain: "anthropic.test",
      industry: "ai",
      size_bucket: "500+",
    });

    const matched = await addCompaniesByFilter(fx.pool, ws, {
      industry: ["fintech"],
    });
    assert.equal(matched.length, 2);
    const list = await listWorkspaceCompanies(fx.pool, ws);
    assert.deepEqual(list.map((c) => c.name).sort(), ["Plaid", "Stripe"]);
  } finally {
    await fx.close();
  }
});

test("catalog: removeCompany + reverse lookup", async (t) => {
  const fx = await setupPg("cat_remove");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws1 = await seedWorkspace(fx.pool);
    const ws2 = await seedWorkspace(fx.pool);
    const co = await upsertTrackedCompany(fx.pool, {
      name: "Stripe",
      domain: "stripe.test",
    });
    await addCompanyExplicit(fx.pool, ws1, co.id);
    await addCompanyExplicit(fx.pool, ws2, co.id);
    const tracking = await findWorkspacesTrackingCompany(fx.pool, co.id);
    assert.deepEqual(tracking.sort(), [ws1, ws2].sort());

    assert.equal(await removeCompany(fx.pool, ws1, co.id), true);
    const after = await findWorkspacesTrackingCompany(fx.pool, co.id);
    assert.deepEqual(after, [ws2]);
  } finally {
    await fx.close();
  }
});
