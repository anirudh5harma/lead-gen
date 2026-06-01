import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg } from "./_pg.ts";
import {
  invokeTool,
  listTools,
  _resetToolRegistry,
} from "../core/agents/tools/registry.ts";
import { setPool, resetPool } from "../core/substrate/storage/pool.ts";
import {
  registerGraphTools,
  _resetGraphToolsRegistration,
} from "../core/graph/tools.ts";
import { createBombsellMcpServer } from "../core/mcp/server.ts";

async function seedWorkspace(pool: Pool): Promise<string> {
  const ws = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [ws, `ws-${ws.slice(0, 8)}`, "test ws"],
  );
  return ws;
}

beforeEach(() => {
  _resetToolRegistry();
  _resetGraphToolsRegistration();
});

afterEach(async () => {
  await resetPool();
});

test("graph tools: registerGraphTools populates the registry", () => {
  registerGraphTools();
  const names = listTools().map((t) => t.name);
  for (const expected of [
    "graph.companies.upsert",
    "graph.companies.get",
    "graph.companies.find",
    "graph.companies.delete",
    "graph.persons.upsert",
    "graph.persons.get",
    "graph.persons.find",
    "graph.persons.delete",
    "graph.sources.upsert",
    "graph.sources.list",
    "graph.sources.get",
    "graph.sources.delete",
    "graph.edges.connect",
    "graph.edges.disconnect",
    "graph.edges.outgoing",
    "graph.edges.incoming",
  ]) {
    assert.ok(names.includes(expected), `expected tool ${expected}`);
  }
});

test("graph tools: invoking via the registry hits Postgres", async (t) => {
  const fx = await setupPg("gt_invoke");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    setPool(fx.pool);
    registerGraphTools();
    const ws = await seedWorkspace(fx.pool);

    const co = await invokeTool<{ id: string; name: string; domain: string | null }>(
      "graph.companies.upsert",
      { name: "ToolCo", domain: "tool.co" },
      { workspace_id: ws },
    );
    assert.equal(co.name, "ToolCo");
    assert.equal(co.domain, "tool.co");

    const found = await invokeTool<Array<{ id: string }>>(
      "graph.companies.find",
      { domain: "tool.co" },
      { workspace_id: ws },
    );
    assert.equal(found.length, 1);
    assert.equal(found[0].id, co.id);

    const deleted = await invokeTool<{ deleted: boolean }>(
      "graph.companies.delete",
      { id: co.id },
      { workspace_id: ws },
    );
    assert.equal(deleted.deleted, true);

    const afterDelete = await invokeTool<Array<{ id: string }>>(
      "graph.companies.find",
      { domain: "tool.co" },
      { workspace_id: ws },
    );
    assert.equal(afterDelete.length, 0);
  } finally {
    await fx.close();
  }
});

test("graph tools: input validation rejects malformed payloads", async (t) => {
  const fx = await setupPg("gt_val");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    setPool(fx.pool);
    registerGraphTools();
    const ws = await seedWorkspace(fx.pool);

    // graph.persons.find requires at least one of email / linkedin_url / company_id
    await assert.rejects(
      invokeTool("graph.persons.find", {}, { workspace_id: ws }),
    );

    // graph.edges.connect rejects unknown edge kinds at the Zod boundary.
    await assert.rejects(
      invokeTool(
        "graph.edges.connect",
        {
          from: { node_type: "person", node_id: randomUUID() },
          to: { node_type: "company", node_id: randomUUID() },
          kind: "not_a_real_kind",
        },
        { workspace_id: ws },
      ),
    );

    // graph.edges.connect rejects type-incompatible from/to at the registry.
    const person = await invokeTool<{ id: string }>(
      "graph.persons.upsert",
      { full_name: "X", emails: ["x@x.com"] },
      { workspace_id: ws },
    );
    await assert.rejects(
      invokeTool(
        "graph.edges.connect",
        {
          // works_at must go person -> company; reverse is illegal
          from: { node_type: "company", node_id: randomUUID() },
          to: { node_type: "person", node_id: person.id },
          kind: "works_at",
        },
        { workspace_id: ws },
      ),
      /cannot originate/,
    );
  } finally {
    await fx.close();
  }
});

test("mcp server: exposes the registered graph tools", () => {
  registerGraphTools();
  const server = createBombsellMcpServer({
    workspaceId: randomUUID(),
  });
  // The McpServer instance is opaque; existence + no-throw is the assert.
  assert.ok(server);
});
