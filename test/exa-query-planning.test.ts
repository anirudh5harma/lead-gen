import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  planExaResearchQuery,
  recommendationResearchPatternKey,
} from "../core/product/exa-query-planning.ts";

test("Exa query planning leaves non-review intents unchanged", async () => {
  const planned = await planExaResearchQuery(fakePool([]), {
    workspace_id: "00000000-0000-4000-8000-000000000001",
    intent: "rep_research",
    query: "AI GTM category movement",
  });

  assert.equal(planned.query, "AI GTM category movement");
  assert.equal(planned.original_query, "AI GTM category movement");
  assert.equal(planned.query_plan, undefined);
});

test("Exa query planning uses recommendation procedural memory for Content research", async () => {
  const planned = await planExaResearchQuery(
    fakePool([
      {
        id: "00000000-0000-4000-8000-000000000101",
        pattern_key: recommendationResearchPatternKey("content_opportunity"),
        score: "0.6700",
        exemplar: {
          kept_examples: [
            { title: "Buyer comparison angle" },
            { title: "Pricing objection angle" },
          ],
          skipped_examples: [{ title: "Generic launch recap" }],
        },
      },
    ]),
    {
      workspace_id: "00000000-0000-4000-8000-000000000001",
      intent: "content_research",
      query: "AI GTM buyer questions",
    },
  );

  assert.match(planned.query, /AI GTM buyer questions/);
  assert.match(planned.query, /operator kept evidence patterns: Buyer comparison angle; Pricing objection angle/);
  assert.match(planned.query, /avoid operator skipped patterns: Generic launch recap/);
  assert.equal(planned.original_query, "AI GTM buyer questions");
  assert.equal(planned.query_plan?.source, "procedural_memory");
  assert.equal(
    planned.query_plan?.pattern_key,
    "recommendation:content_opportunity|stage:exa_review",
  );
  assert.deepEqual(planned.query_plan?.kept_examples, [
    "Buyer comparison angle",
    "Pricing objection angle",
  ]);
  assert.deepEqual(planned.query_plan?.skipped_examples, ["Generic launch recap"]);
});

function fakePool(rows: Array<{
  id: string;
  pattern_key: string;
  exemplar: Record<string, unknown>;
  score: string;
}>): Pool {
  return {
    async query() {
      return { rows };
    },
  } as unknown as Pool;
}
