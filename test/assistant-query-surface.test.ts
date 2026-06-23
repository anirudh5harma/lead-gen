import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  assistantQueryToolSpecs,
  dispatchAssistantQueryTool,
  validateAssistantQueryInvocation,
} from "../core/product/assistant/query-surface.ts";
import { resetPool, setPool } from "../core/substrate/storage/pool.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await resetPool();
});

test("assistant query surface exposes only curated tool names", () => {
  const names = assistantQueryToolSpecs().map((tool) => tool.function.name);
  assert.ok(names.includes("metrics_get"));
  assert.ok(names.includes("entities_find"));
  assert.ok(names.includes("entities_get"));
  assert.ok(names.includes("signals_list"));
  assert.ok(names.every((name) => /^[a-zA-Z0-9_-]+$/.test(name)));
  assert.ok(!names.some((name) => /upsert|delete/.test(name)));
  assert.ok(!names.includes("graph.companies.upsert"));
  assert.ok(!names.includes("graph.persons.delete"));
});

test("assistant query surface scopes aggregate metrics by window", async () => {
  const seenSql: string[] = [];
  setPool({
    query: async (sql: string) => {
      seenSql.push(sql);
      return { rows: [{ companies_targeted: "7" }] };
    },
    end: async () => {},
  } as never);

  const today = await dispatchAssistantQueryTool({
    toolName: "metrics_get",
    arguments: { metric: "companies_targeted", window: "today" },
    ctx: { workspace_id: WORKSPACE_ID, user_id: USER_ID },
  });
  const thirtyDays = await dispatchAssistantQueryTool({
    toolName: "metrics_get",
    arguments: { metric: "companies_targeted", window: "30d" },
    ctx: { workspace_id: WORKSPACE_ID, user_id: USER_ID },
  });
  const allTime = await dispatchAssistantQueryTool({
    toolName: "metrics_get",
    arguments: { metric: "companies_targeted", window: "all" },
    ctx: { workspace_id: WORKSPACE_ID, user_id: USER_ID },
  });

  assert.equal(today.value, 7);
  assert.equal(thirtyDays.value, 7);
  assert.equal(allTime.value, 7);
  assert.match(seenSql[0] ?? "", /date_trunc\('day', now\(\)\)/);
  assert.match(seenSql[1] ?? "", /interval '30 days'/);
  assert.match(seenSql[2] ?? "", /and true/);
});

test("assistant query surface rejects invalid arguments", () => {
  assert.throws(
    () =>
      validateAssistantQueryInvocation({
        toolName: "metrics_get",
        arguments: { metric: "reply_rate", window: "90d" },
      }),
    /Invalid arguments for metrics_get/i,
  );

  assert.throws(
    () =>
      validateAssistantQueryInvocation({
        toolName: "entities_find",
        arguments: { entity_type: "person" },
      }),
    /person lookups require email, linkedin_url, or company_id/i,
  );
});
