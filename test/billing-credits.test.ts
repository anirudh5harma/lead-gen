import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";

const {
  isProEntitled,
  isOutreachEntitled,
  reserveCredit,
  refundCredit,
  grantTrialCredits,
  getWorkspaceBillingState,
} = await import("../core/billing/credits.ts");

function result(rows: Record<string, unknown>[]): QueryResult {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as QueryResult["rows"],
  };
}

/** A pool whose connect() yields a client that answers by SQL substring. */
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

function queryResult(
  rows: Record<string, unknown>[] = [],
  overrides: Partial<QueryResult> = {},
): QueryResult {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as QueryResult["rows"],
    ...overrides,
  };
}

function recordingPool(
  handler: (
    sql: string,
    params: unknown[] | undefined,
  ) => QueryResult | Promise<QueryResult>,
  recorded: Array<{ sql: string; params: unknown[] | undefined }>,
): Pool {
  const client: Partial<PoolClient> = {
    query: (async (sql: string, params?: unknown[]) => {
      recorded.push({ sql: String(sql), params });
      return await handler(String(sql), params);
    }) as PoolClient["query"],
    release: (() => {}) as PoolClient["release"],
  };
  const pool: Partial<Pool> = {
    connect: (async () => client) as Pool["connect"],
    query: (async (sql: string, params?: unknown[]) => {
      recorded.push({ sql: String(sql), params });
      return await handler(String(sql), params);
    }) as Pool["query"],
  };
  return pool as Pool;
}

const future = new Date(Date.now() + 7 * 86_400_000);
const past = new Date(Date.now() - 86_400_000);

test("isProEntitled covers the subscription matrix", () => {
  assert.equal(isProEntitled({ subscription_status: "active", subscription_renews_at: null }), true);
  assert.equal(isProEntitled({ subscription_status: "canceled", subscription_renews_at: future }), true);
  assert.equal(isProEntitled({ subscription_status: "canceled", subscription_renews_at: past }), false);
  assert.equal(isProEntitled({ subscription_status: "expired", subscription_renews_at: future }), false);
  assert.equal(isProEntitled({ subscription_status: "inactive", subscription_renews_at: null }), false);
});

test("isOutreachEntitled is true on Pro or remaining credits, false when frozen", async () => {
  const workspaceId = randomUUID();
  const proPool = scriptedPool(() => [
    {
      trial_credits_remaining: 0,
      trial_credits_total: 15,
      subscription_status: "active",
      subscription_renews_at: null,
    },
  ]);
  const trialPool = scriptedPool(() => [
    {
      trial_credits_remaining: 3,
      trial_credits_total: 15,
      subscription_status: "inactive",
      subscription_renews_at: null,
    },
  ]);
  const frozenPool = scriptedPool(() => [
    {
      trial_credits_remaining: 0,
      trial_credits_total: 15,
      subscription_status: "inactive",
      subscription_renews_at: null,
    },
  ]);
  assert.equal(await isOutreachEntitled(proPool, workspaceId), true);
  assert.equal(await isOutreachEntitled(trialPool, workspaceId), true);
  assert.equal(await isOutreachEntitled(frozenPool, workspaceId), false);
});

test("getWorkspaceBillingState derives tier/frozen/canceled", async () => {
  const trialFrozen = await getWorkspaceBillingState(
    scriptedPool(() => [
      { trial_credits_remaining: 0, trial_credits_total: 15, subscription_status: "inactive", subscription_renews_at: null },
    ]),
    randomUUID(),
  );
  assert.deepEqual(
    {
      tier: trialFrozen.tier,
      frozen: trialFrozen.frozen,
      entitled: trialFrozen.entitled,
      source: trialFrozen.source,
      portal: trialFrozen.portal_available,
    },
    { tier: "trial", frozen: true, entitled: false, source: "trial", portal: false },
  );

  const proCanceled = await getWorkspaceBillingState(
    scriptedPool(() => [
      { trial_credits_remaining: 0, trial_credits_total: 15, subscription_status: "canceled", subscription_renews_at: future },
    ]),
    randomUUID(),
  );
  assert.equal(proCanceled.tier, "pro");
  assert.equal(proCanceled.frozen, false);
  assert.equal(proCanceled.canceled, true);
  assert.equal(proCanceled.source, "subscription");
});

test("getWorkspaceBillingState honors legacy billing overrides without exposing the portal", async () => {
  const legacyPro = await getWorkspaceBillingState(
    scriptedPool(() => [
      {
        trial_credits_remaining: 15,
        trial_credits_total: 15,
        subscription_status: "inactive",
        subscription_renews_at: null,
        dodo_customer_id: null,
        subscription_external_id: null,
        settings: {
          billing_override: {
            tier: "pro",
            active: true,
            source: "legacy_launch_plan",
          },
        },
      },
    ]),
    randomUUID(),
  );

  assert.equal(legacyPro.tier, "pro");
  assert.equal(legacyPro.entitled, true);
  assert.equal(legacyPro.frozen, false);
  assert.equal(legacyPro.source, "legacy_override");
  assert.equal(legacyPro.portal_available, false);
  assert.equal(legacyPro.subscription_status, "legacy_override");
});

test("reserveCredit: Pro is unlimited and unmetered", async () => {
  const r = await reserveCredit(
    scriptedPool((sql) =>
      sql.includes("for update")
        ? [{ trial_credits_remaining: 0, trial_credits_total: 15, subscription_status: "active", subscription_renews_at: null }]
        : [],
    ),
    { workspace_id: randomUUID(), message_id: randomUUID() },
  );
  assert.deepEqual({ ok: r.ok, metered: r.metered }, { ok: true, metered: false });
});

test("reserveCredit: trial consume decrements and flags low/zero crossings", async () => {
  // remaining 6 -> 5 crosses the low threshold.
  const low = await reserveCredit(
    scriptedPool((sql) => {
      if (sql.includes("for update")) return [{ trial_credits_remaining: 6, trial_credits_total: 15, subscription_status: "inactive", subscription_renews_at: null }];
      if (sql.includes("from billing_credit_ledger")) return []; // not yet charged
      if (sql.startsWith("update workspaces") || sql.includes("trial_credits_remaining = trial_credits_remaining - 1")) return [{ trial_credits_remaining: 5 }];
      return [];
    }),
    { workspace_id: randomUUID(), message_id: randomUUID() },
  );
  assert.deepEqual(
    { ok: low.ok, metered: low.metered, remaining: low.remaining, crossedLow: low.crossedLow, crossedZero: low.crossedZero },
    { ok: true, metered: true, remaining: 5, crossedLow: true, crossedZero: false },
  );

  // remaining 1 -> 0 crosses zero.
  const zero = await reserveCredit(
    scriptedPool((sql) => {
      if (sql.includes("for update")) return [{ trial_credits_remaining: 1, trial_credits_total: 15, subscription_status: "inactive", subscription_renews_at: null }];
      if (sql.includes("from billing_credit_ledger")) return [];
      if (sql.includes("trial_credits_remaining = trial_credits_remaining - 1")) return [{ trial_credits_remaining: 0 }];
      return [];
    }),
    { workspace_id: randomUUID(), message_id: randomUUID() },
  );
  assert.equal(zero.crossedZero, true);
  assert.equal(zero.crossedLow, false);
});

test("reserveCredit: idempotent when message already charged", async () => {
  const r = await reserveCredit(
    scriptedPool((sql) => {
      if (sql.includes("for update")) return [{ trial_credits_remaining: 4, trial_credits_total: 15, subscription_status: "inactive", subscription_renews_at: null }];
      if (sql.includes("from billing_credit_ledger")) return [{ "?column?": 1 }]; // already consumed
      return [];
    }),
    { workspace_id: randomUUID(), message_id: randomUUID() },
  );
  // ok without a second decrement; remaining unchanged at 4.
  assert.deepEqual({ ok: r.ok, metered: r.metered, remaining: r.remaining }, { ok: true, metered: true, remaining: 4 });
});

test("reserveCredit: refuses when trial balance is zero (frozen)", async () => {
  const r = await reserveCredit(
    scriptedPool((sql) => {
      if (sql.includes("for update")) return [{ trial_credits_remaining: 0, trial_credits_total: 15, subscription_status: "inactive", subscription_renews_at: null }];
      if (sql.includes("from billing_credit_ledger")) return [];
      return [];
    }),
    { workspace_id: randomUUID(), message_id: randomUUID() },
  );
  assert.deepEqual({ ok: r.ok, metered: r.metered, remaining: r.remaining }, { ok: false, metered: true, remaining: 0 });
});

test("refundCredit: restores one credit and clears exhausted_at after a consumed send", async () => {
  const recorded: Array<{ sql: string; params: unknown[] | undefined }> = [];
  await refundCredit(
    recordingPool((sql) => {
      if (sql.includes("reason = 'consume'")) return queryResult([{ ok: 1 }]);
      if (sql.includes("reason = 'refund'")) return queryResult([]);
      return queryResult([]);
    }, recorded),
    { workspace_id: randomUUID(), message_id: randomUUID() },
  );

  const update = recorded.find((entry) =>
    entry.sql.includes("trial_credits_remaining = least(trial_credits_total, trial_credits_remaining + 1)")
  );
  assert.ok(update, "refund should increment the workspace counter");
  assert.match(
    update.sql,
    /credits_exhausted_at = case\s+when trial_credits_remaining \+ 1 > 0 then null/i,
  );
});

test("grantTrialCredits: updates the workspace counters only on the first grant", async () => {
  const first: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const firstGranted = await grantTrialCredits(
    recordingPool((sql) => {
      if (sql.includes("reason)")) {
        return queryResult([{ one: 1 }], { command: "INSERT", rowCount: 1 });
      }
      return queryResult([]);
    }, first),
    randomUUID(),
  );
  assert.equal(firstGranted, true);
  assert.ok(
    first.some((entry) => entry.sql.includes("set trial_credits_total = $2")),
    "first grant should seed total and remaining credits",
  );

  const second: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const secondGranted = await grantTrialCredits(
    recordingPool((sql) => {
      if (sql.includes("reason)")) {
        return queryResult([], { command: "INSERT", rowCount: 0 });
      }
      return queryResult([]);
    }, second),
    randomUUID(),
  );
  assert.equal(secondGranted, false);
  assert.equal(
    second.some((entry) => entry.sql.includes("set trial_credits_total = $2")),
    false,
  );
});
