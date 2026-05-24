import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import { upsertCompany } from "../core/graph/nodes/companies.ts";
import { upsertPerson } from "../core/graph/nodes/persons.ts";
import {
  connect,
  disconnect,
  incoming,
  outgoing,
} from "../core/graph/edges/queries.ts";
import { validateEdge } from "../core/graph/edges/registry.ts";

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "test ws"],
  );
  return ws;
}

test("edges: registry rejects illegal from/to combinations", () => {
  assert.throws(() => validateEdge("works_at", "company", "person"), /cannot originate/);
  assert.throws(() => validateEdge("authored_by", "post", "company"), /cannot target/);
  // Legal:
  validateEdge("works_at", "person", "company");
  validateEdge("mentioned_in", "person", "signal");
  validateEdge("mentioned_in", "company", "signal");
});

test("edges: connect a person to a company (works_at, singleton)", async (t) => {
  const fx = await setupPg("e_works");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const co1 = await upsertCompany(fx.pool, ws, { name: "Old", domain: "old.com" });
    const co2 = await upsertCompany(fx.pool, ws, { name: "New", domain: "new.com" });
    const person = await upsertPerson(fx.pool, ws, {
      full_name: "Switcher",
      emails: ["s@old.com"],
    });

    await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "company", node_id: co1.id },
      kind: "works_at",
    });

    // Singleton replace: the new connection drops the old edge.
    await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "company", node_id: co2.id },
      kind: "works_at",
    });

    const out = await outgoing(fx.pool, {
      workspace_id: ws,
      node: { node_type: "person", node_id: person.id },
      kinds: ["works_at"],
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].to_node_id, co2.id);
  } finally {
    await fx.close();
  }
});

test("edges: connect multi edges (mentioned_in)", async (t) => {
  const fx = await setupPg("e_mention");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const person = await upsertPerson(fx.pool, ws, {
      full_name: "Mentioned",
      emails: ["m@example.com"],
    });
    const signalA = randomUUID();
    const signalB = randomUUID();
    // We need real signals so the FK isn't a concern for edges (edges
    // table is polymorphic with no FK to graph_persons or signals).
    await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "signal", node_id: signalA },
      kind: "mentioned_in",
      provenance: { source: "test" },
    });
    await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "signal", node_id: signalB },
      kind: "mentioned_in",
    });

    const out = await outgoing(fx.pool, {
      workspace_id: ws,
      node: { node_type: "person", node_id: person.id },
      kinds: ["mentioned_in"],
    });
    assert.equal(out.length, 2);

    const inA = await incoming(fx.pool, {
      workspace_id: ws,
      node: { node_type: "signal", node_id: signalA },
    });
    assert.equal(inA.length, 1);
    assert.equal(inA[0].from_node_id, person.id);
  } finally {
    await fx.close();
  }
});

test("edges: connect dedups identical triples (multi kind, schema unique)", async (t) => {
  const fx = await setupPg("e_dedup");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const person = await upsertPerson(fx.pool, ws, {
      full_name: "Dup",
      emails: ["dup@example.com"],
    });
    const signal = randomUUID();
    const a = await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "signal", node_id: signal },
      kind: "mentioned_in",
      properties: { round: 1 },
    });
    const b = await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "signal", node_id: signal },
      kind: "mentioned_in",
      properties: { round: 2 },
    });
    assert.equal(a.id, b.id);
    // Properties merged: original round=1 overwritten by round=2 via jsonb ||.
    assert.equal((b.properties as { round: number }).round, 2);
  } finally {
    await fx.close();
  }
});

test("edges: disconnect by target and by kind-from-node", async (t) => {
  const fx = await setupPg("e_disc");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const ws = await seedWorkspace(fx.pool);
    const person = await upsertPerson(fx.pool, ws, {
      full_name: "X",
      emails: ["x@example.com"],
    });
    const s1 = randomUUID();
    const s2 = randomUUID();
    await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "signal", node_id: s1 },
      kind: "mentioned_in",
    });
    await connect(fx.pool, {
      workspace_id: ws,
      from: { node_type: "person", node_id: person.id },
      to: { node_type: "signal", node_id: s2 },
      kind: "mentioned_in",
    });

    const deleted1 = await disconnect(
      fx.pool,
      ws,
      { node_type: "person", node_id: person.id },
      "mentioned_in",
      { node_type: "signal", node_id: s1 },
    );
    assert.equal(deleted1, 1);

    const deletedRest = await disconnect(
      fx.pool,
      ws,
      { node_type: "person", node_id: person.id },
      "mentioned_in",
    );
    assert.equal(deletedRest, 1);

    const out = await outgoing(fx.pool, {
      workspace_id: ws,
      node: { node_type: "person", node_id: person.id },
    });
    assert.equal(out.length, 0);
  } finally {
    await fx.close();
  }
});
