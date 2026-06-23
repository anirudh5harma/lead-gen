import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import { getWorkspaceActivationState } from "../core/product/activation-state.ts";

function result(rows: Record<string, unknown>[]): QueryResult {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as QueryResult["rows"],
  };
}

function scriptedPool(
  handler: (sql: string) => Record<string, unknown>[],
): Pool {
  const client: Partial<PoolClient> = {
    query: (async (sql: string) => result(handler(String(sql)))) as PoolClient["query"],
    release: (() => {}) as PoolClient["release"],
  };
  const pool: Partial<Pool> = {
    connect: (async () => client) as Pool["connect"],
    query: (async (sql: string) => result(handler(String(sql)))) as Pool["query"],
  };
  return pool as Pool;
}

test("getWorkspaceActivationState returns false flags when no workspace profile exists", async () => {
  const state = await getWorkspaceActivationState(scriptedPool(() => []), randomUUID());
  assert.deepEqual(state, {
    website_set: false,
    description_set: false,
    product_ready: false,
  });
});

test("getWorkspaceActivationState reports website pending when description is missing", async () => {
  const state = await getWorkspaceActivationState(
    scriptedPool(() => [{ website_url: "https://acme.example", description: null }]),
    randomUUID(),
  );
  assert.deepEqual(state, {
    website_set: true,
    description_set: false,
    product_ready: false,
  });
});

test("getWorkspaceActivationState reports ready only when website and description are present", async () => {
  const state = await getWorkspaceActivationState(
    scriptedPool(() => [{
      website_url: "https://acme.example",
      description: "Acme helps GTM teams act on verified buying signals.",
    }]),
    randomUUID(),
  );
  assert.deepEqual(state, {
    website_set: true,
    description_set: true,
    product_ready: true,
  });
});
