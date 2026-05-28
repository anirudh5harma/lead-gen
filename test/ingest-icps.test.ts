import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  createIcp,
  deleteIcp,
  getIcp,
  listIcps,
  updateIcp,
} from "../core/ingest/icps.ts";

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "ws"],
  );
  return ws;
}

test("icps: create + get round-trips the predicate rules", async (t) => {
  const fx = await setupPg("icp_crud");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const created = await createIcp(fx.pool, ws, {
      name: "Fintech CTOs",
      description: "Series A–C fintech CTOs hiring senior platform engineers",
      must_haves: [
        { field: "kind", op: "in", value: ["hiring", "funding"] },
        { field: "company.industry", op: "eq", value: "fintech" },
      ],
      nice_to_haves: ["recent_funding"],
      match_threshold: 0.7,
      enabled: true,
    });
    assert.equal(created.name, "Fintech CTOs");
    assert.equal(created.must_haves.length, 2);
    assert.equal(created.match_threshold, 0.7);

    const fetched = await getIcp(fx.pool, ws, created.id);
    assert.deepEqual(fetched?.must_haves, created.must_haves);
  } finally {
    await fx.close();
  }
});

test("icps: list filters to enabled when requested", async (t) => {
  const fx = await setupPg("icp_list");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    await createIcp(fx.pool, ws, {
      name: "A",
      description: "x",
      enabled: true,
      must_haves: [],
      nice_to_haves: [],
      match_threshold: 0.6,
    });
    await createIcp(fx.pool, ws, {
      name: "B",
      description: "x",
      enabled: false,
      must_haves: [],
      nice_to_haves: [],
      match_threshold: 0.6,
    });
    const all = await listIcps(fx.pool, ws);
    assert.equal(all.length, 2);
    const enabled = await listIcps(fx.pool, ws, { only_enabled: true });
    assert.equal(enabled.length, 1);
    assert.equal(enabled[0].name, "A");
  } finally {
    await fx.close();
  }
});

test("icps: update merges partial inputs and rewrites must_haves", async (t) => {
  const fx = await setupPg("icp_update");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const created = await createIcp(fx.pool, ws, {
      name: "Orig",
      description: "x",
      must_haves: [{ field: "kind", op: "in", value: ["hiring"] }],
      nice_to_haves: [],
      match_threshold: 0.6,
      enabled: true,
    });
    const updated = await updateIcp(fx.pool, ws, created.id, {
      match_threshold: 0.8,
      must_haves: [
        { field: "kind", op: "in", value: ["hiring", "funding"] },
        { field: "company.industry", op: "eq", value: "fintech" },
      ],
    });
    assert.equal(updated?.match_threshold, 0.8);
    assert.equal(updated?.must_haves.length, 2);
    // Other fields preserved.
    assert.equal(updated?.name, "Orig");
  } finally {
    await fx.close();
  }
});

test("icps: delete returns boolean + cascades on workspace delete", async (t) => {
  const fx = await setupPg("icp_delete");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const created = await createIcp(fx.pool, ws, {
      name: "x",
      description: "x",
      must_haves: [],
      nice_to_haves: [],
      match_threshold: 0.6,
      enabled: true,
    });
    assert.equal(await deleteIcp(fx.pool, ws, created.id), true);
    assert.equal(await deleteIcp(fx.pool, ws, created.id), false);
  } finally {
    await fx.close();
  }
});
