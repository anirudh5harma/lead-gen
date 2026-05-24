import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  findCompanyByDomain,
  getCompany,
  listCompaniesByName,
  upsertCompany,
} from "../core/graph/nodes/companies.ts";
import {
  findPersonByEmail,
  findPersonByLinkedIn,
  listPersonsForCompany,
  upsertPerson,
} from "../core/graph/nodes/persons.ts";
import {
  listSources,
  upsertSource,
} from "../core/graph/nodes/sources.ts";

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "test ws"],
  );
  return ws;
}

// ─── Companies ─────────────────────────────────────────────────────────────

test("companies: upsert by domain is idempotent and merges properties", async (t) => {
  const fx = await setupPg("g_co");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const first = await upsertCompany(fx.pool, ws, {
      name: "Acme",
      domain: "acme.com",
      industry: "fintech",
      properties: { tier: "T1" },
    });
    const second = await upsertCompany(fx.pool, ws, {
      name: "Acme Corp",
      domain: "acme.com",
      properties: { region: "EU" },
    });
    assert.equal(first.id, second.id);
    assert.equal(second.name, "Acme Corp");
    assert.equal(second.industry, "fintech");
    assert.deepEqual(second.properties, { tier: "T1", region: "EU" });
  } finally {
    await fx.close();
  }
});

test("companies: name-based upsert falls back when no domain", async (t) => {
  const fx = await setupPg("g_co_name");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const a = await upsertCompany(fx.pool, ws, { name: "Stealth Inc" });
    const b = await upsertCompany(fx.pool, ws, { name: "stealth inc" });
    assert.equal(a.id, b.id);
  } finally {
    await fx.close();
  }
});

test("companies: find by domain + list by name", async (t) => {
  const fx = await setupPg("g_co_find");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    await upsertCompany(fx.pool, ws, { name: "Foo Labs", domain: "foo.com" });
    await upsertCompany(fx.pool, ws, { name: "Foo Industries", domain: "fooind.com" });
    await upsertCompany(fx.pool, ws, { name: "Bar", domain: "bar.com" });

    const byDomain = await findCompanyByDomain(fx.pool, ws, "foo.com");
    assert.equal(byDomain?.name, "Foo Labs");

    const byName = await listCompaniesByName(fx.pool, ws, "foo");
    assert.equal(byName.length, 2);
  } finally {
    await fx.close();
  }
});

test("companies: workspace isolation", async (t) => {
  const fx = await setupPg("g_co_iso");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const wsA = await seedWorkspace(fx.pool);
    const wsB = await seedWorkspace(fx.pool);
    const a = await upsertCompany(fx.pool, wsA, {
      name: "Same",
      domain: "same.com",
    });
    const b = await upsertCompany(fx.pool, wsB, {
      name: "Same",
      domain: "same.com",
    });
    assert.notEqual(a.id, b.id);
    assert.equal(await getCompany(fx.pool, wsA, b.id), null);
  } finally {
    await fx.close();
  }
});

// ─── Persons ───────────────────────────────────────────────────────────────

test("persons: upsert keyed by linkedin_url collapses duplicates", async (t) => {
  const fx = await setupPg("g_p_li");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const a = await upsertPerson(fx.pool, ws, {
      full_name: "Anne Doe",
      linkedin_url: "https://linkedin.com/in/anne",
      emails: ["anne@old.com"],
    });
    const b = await upsertPerson(fx.pool, ws, {
      full_name: "Anne Doe (CEO)",
      linkedin_url: "https://linkedin.com/in/anne",
      emails: ["anne@new.com"],
      title: "CEO",
    });
    assert.equal(a.id, b.id);
    assert.equal(b.title, "CEO");
    // Emails should be the union, deduped.
    assert.deepEqual(b.emails.sort(), ["anne@new.com", "anne@old.com"]);
  } finally {
    await fx.close();
  }
});

test("persons: upsert by overlapping email merges rows", async (t) => {
  const fx = await setupPg("g_p_email");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const a = await upsertPerson(fx.pool, ws, {
      full_name: "Beth",
      emails: ["beth@x.com"],
    });
    const b = await upsertPerson(fx.pool, ws, {
      full_name: "Beth Smith",
      emails: ["beth@x.com", "beth@y.com"],
    });
    assert.equal(a.id, b.id);
    assert.deepEqual(b.emails.sort(), ["beth@x.com", "beth@y.com"]);
  } finally {
    await fx.close();
  }
});

test("persons: find by email and linkedin, list for company", async (t) => {
  const fx = await setupPg("g_p_find");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const co = await upsertCompany(fx.pool, ws, { name: "FindCo", domain: "find.co" });
    await upsertPerson(fx.pool, ws, {
      full_name: "Carl",
      company_id: co.id,
      emails: ["carl@find.co"],
      linkedin_url: "https://linkedin.com/in/carl",
    });
    await upsertPerson(fx.pool, ws, {
      full_name: "Dora",
      company_id: co.id,
      emails: ["dora@find.co"],
    });

    const byEmail = await findPersonByEmail(fx.pool, ws, "carl@find.co");
    assert.equal(byEmail?.full_name, "Carl");

    const byLinked = await findPersonByLinkedIn(fx.pool, ws, "https://linkedin.com/in/carl");
    assert.equal(byLinked?.full_name, "Carl");

    const forCompany = await listPersonsForCompany(fx.pool, ws, co.id);
    assert.equal(forCompany.length, 2);
  } finally {
    await fx.close();
  }
});

test("persons: case-insensitive email lookup (citext)", async (t) => {
  const fx = await setupPg("g_p_ci");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    await upsertPerson(fx.pool, ws, {
      full_name: "Eve",
      emails: ["Eve@Example.COM"],
    });
    const got = await findPersonByEmail(fx.pool, ws, "eve@example.com");
    assert.equal(got?.full_name, "Eve");
  } finally {
    await fx.close();
  }
});

// ─── Sources ───────────────────────────────────────────────────────────────

test("sources: upsert by (kind, name) and list", async (t) => {
  const fx = await setupPg("g_src");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const a = await upsertSource(fx.pool, ws, {
      kind: "rss",
      name: "techcrunch",
      config: { url: "https://tc.com/feed" },
    });
    const b = await upsertSource(fx.pool, ws, {
      kind: "rss",
      name: "techcrunch",
      config: { url: "https://techcrunch.com/feed" },
      properties: { region: "us" },
    });
    assert.equal(a.id, b.id);
    assert.equal((b.config as { url: string }).url, "https://techcrunch.com/feed");
    assert.equal((b.properties as { region: string }).region, "us");

    await upsertSource(fx.pool, ws, { kind: "hn", name: "front" });
    const all = await listSources(fx.pool, ws);
    assert.equal(all.length, 2);
    const justRss = await listSources(fx.pool, ws, "rss");
    assert.equal(justRss.length, 1);
  } finally {
    await fx.close();
  }
});
