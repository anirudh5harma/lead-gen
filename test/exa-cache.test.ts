import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  exaQueryHash,
  searchExaWithWorkspaceCache,
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

interface MockExaPool extends Pick<Pool, "query"> {
  contentWrites: number;
  operations: string[];
  workspaceId: string | null;
}

function firstWorkspaceId(pool: MockExaPool): string {
  assert.ok(pool.workspaceId);
  return pool.workspaceId;
}

function createMockExaPool(): MockExaPool {
  const queryCache = new Map<string, { request_id: string | null; response: ExaSearchResponse }>();
  const pool: MockExaPool = {
    contentWrites: 0,
    operations: [],
    workspaceId: null,
    async query(sql: string, params?: unknown[]) {
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
