import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ExaBudgetExceededError,
  exaQueryHash,
  getExaContentsWithWorkspaceBudget,
  searchExaWithWorkspaceCache,
  type ExaContentsResponse,
  type ExaSearchResponse,
} from "../core/exa/index.ts";
import type { Pool } from "pg";

test("Exa query hash normalizes whitespace and ordered domain options", () => {
  const first = exaQueryHash({
    intent: "rep_research",
    search: {
      query: "  Acme funding   signals ",
      includeDomains: ["b.example", "a.example"],
      numResults: 8,
      includeText: true,
    },
  });
  const second = exaQueryHash({
    intent: "rep_research",
    search: {
      query: "Acme funding signals",
      includeDomains: ["a.example", "b.example"],
      numResults: 8,
      includeText: true,
    },
  });

  assert.equal(first, second);
});

test("Exa workspace cache records live search once and serves the next call from cache", async () => {
  const pool = createMockExaPool();
  let liveCalls = 0;
  const client = {
    async search(): Promise<ExaSearchResponse> {
      liveCalls += 1;
      return {
        requestId: "req_live_1",
        autopromptString: null,
        results: [{
          id: "exa_1",
          url: "https://example.com/proof?b=2&a=1#section",
          title: "Proof",
          score: 0.91,
          publishedDate: null,
          author: null,
          text: "Clean page text",
          highlights: ["useful proof"],
          summary: "Useful proof",
          image: null,
          favicon: null,
          raw: { id: "exa_1" },
        }],
        raw: { requestId: "req_live_1" },
      };
    },
  };

  const first = await searchExaWithWorkspaceCache({
    pool,
    workspace_id: randomUUID(),
    intent: "rep_research",
    client,
    search: {
      query: "Acme funding signals",
      numResults: 8,
      includeText: true,
    },
  });
  const second = await searchExaWithWorkspaceCache({
    pool,
    workspace_id: firstWorkspaceId(pool),
    intent: "rep_research",
    client,
    search: {
      query: "  Acme funding   signals ",
      numResults: 8,
      includeText: true,
    },
  });

  assert.equal(first.cache_hit, false);
  assert.equal(second.cache_hit, true);
  assert.equal(liveCalls, 1);
  assert.equal(second.response.requestId, "req_live_1");
  assert.equal(pool.contentWrites, 1);
  assert.deepEqual(pool.operations, ["search", "search_cache_hit"]);
});

test("Exa workspace cache defers live searches when direct query budget is exhausted", async () => {
  const pool = createMockExaPool({
    budget: {
      daily_query_cap: "1",
      queries_24h: "1",
    },
  });
  let liveCalls = 0;
  const client = {
    async search(): Promise<ExaSearchResponse> {
      liveCalls += 1;
      throw new Error("live search should not run");
    },
  };

  await assert.rejects(
    searchExaWithWorkspaceCache({
      pool,
      workspace_id: randomUUID(),
      intent: "rep_research",
      client,
      search: {
        query: "Acme hiring signals",
        numResults: 5,
      },
    }),
    (err) => err instanceof ExaBudgetExceededError &&
      err.reason === "daily_query_cap_exhausted",
  );

  assert.equal(liveCalls, 0);
  assert.deepEqual(pool.operations, ["search_deferred"]);
});

test("Exa contents fetch records usage and defers when contents budget is exhausted", async () => {
  const pool = createMockExaPool();
  let liveCalls = 0;
  const client = {
    async getContents(): Promise<ExaContentsResponse> {
      liveCalls += 1;
      return {
        requestId: "req_contents_1",
        results: [{
          id: "exa_2",
          url: "https://example.com/page",
          title: "Page",
          score: null,
          publishedDate: null,
          author: null,
          text: "Page text",
          highlights: [],
          summary: null,
          image: null,
          favicon: null,
          raw: {},
        }],
        raw: {},
      };
    },
  };

  await getExaContentsWithWorkspaceBudget({
    pool,
    workspace_id: randomUUID(),
    intent: "draft_grounding",
    client,
    contents: { urls: ["https://example.com/page"], includeText: true },
  });

  assert.equal(liveCalls, 1);
  assert.deepEqual(pool.operations, ["contents"]);

  const exhaustedPool = createMockExaPool({
    budget: {
      daily_contents_cap: "1",
      contents_24h: "1",
    },
  });
  await assert.rejects(
    getExaContentsWithWorkspaceBudget({
      pool: exhaustedPool,
      workspace_id: randomUUID(),
      intent: "draft_grounding",
      client,
      contents: { urls: ["https://example.com/other"], includeText: true },
    }),
    (err) => err instanceof ExaBudgetExceededError &&
      err.reason === "daily_contents_cap_exhausted",
  );
  assert.deepEqual(exhaustedPool.operations, ["contents_deferred"]);
});

interface MockExaPool extends Pick<Pool, "query"> {
  contentWrites: number;
  operations: string[];
  workspaceId: string | null;
  budget: Partial<Record<
    | "daily_query_cap"
    | "daily_contents_cap"
    | "monthly_unit_cap"
    | "per_play_research_cap"
    | "queries_24h"
    | "contents_24h"
    | "units_month"
    | "play_research_24h"
    | "deferred_24h"
    | "active_query_entries"
    | "active_content_entries"
    | "cache_hits_24h",
    string
  >>;
}

function firstWorkspaceId(pool: MockExaPool): string {
  assert.ok(pool.workspaceId);
  return pool.workspaceId;
}

function createMockExaPool(input: {
  budget?: MockExaPool["budget"];
} = {}): MockExaPool {
  const queryCache = new Map<string, { request_id: string | null; response: ExaSearchResponse }>();
  const pool: MockExaPool = {
    contentWrites: 0,
    operations: [],
    workspaceId: null,
    budget: input.budget ?? {},
    async query(sql: string, params?: unknown[]) {
      if (sql.includes("from workspaces")) {
        return {
          rows: [{
            daily_query_cap: pool.budget.daily_query_cap ?? null,
            daily_contents_cap: pool.budget.daily_contents_cap ?? null,
            monthly_unit_cap: pool.budget.monthly_unit_cap ?? null,
            per_play_research_cap: pool.budget.per_play_research_cap ?? null,
            queries_24h: pool.budget.queries_24h ?? "0",
            contents_24h: pool.budget.contents_24h ?? "0",
            units_month: pool.budget.units_month ?? "0",
            play_research_24h: pool.budget.play_research_24h ?? "0",
            deferred_24h: pool.budget.deferred_24h ?? "0",
            active_query_entries: pool.budget.active_query_entries ?? "0",
            active_content_entries: pool.budget.active_content_entries ?? "0",
            cache_hits_24h: pool.budget.cache_hits_24h ?? "0",
          }],
        };
      }
      if (sql.includes("from workspace_exa_query_cache")) {
        const key = cacheKey(params);
        const cached = queryCache.get(key);
        return { rows: cached ? [cached] : [] };
      }
      if (sql.includes("insert into workspace_exa_query_cache")) {
        pool.workspaceId = String(params?.[0]);
        const key = cacheKey(params);
        queryCache.set(key, {
          request_id: String(params?.[5]),
          response: JSON.parse(String(params?.[7])) as ExaSearchResponse,
        });
        return { rows: [] };
      }
      if (sql.includes("insert into workspace_exa_content_cache")) {
        pool.contentWrites += 1;
        return { rows: [] };
      }
      if (sql.includes("insert into workspace_exa_usage")) {
        pool.operations.push(String(params?.[3]));
        return { rows: [{ id: randomUUID() }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return pool;
}

function cacheKey(params: unknown[] | undefined): string {
  return `${params?.[0]}:${params?.[1]}:${params?.[2]}`;
}
