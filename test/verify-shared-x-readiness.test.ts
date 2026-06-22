import assert from "node:assert/strict";
import test from "node:test";
import {
  runSharedXReadinessProbe,
  type SharedXReadinessResult,
} from "../scripts/verify-shared-x-readiness.ts";

test("shared X readiness: missing DATABASE_URL fails without querying", async () => {
  const result = await runSharedXReadinessProbe({ env: {} });

  assert.equal(result.ok, false);
  assert.equal(result.steps[0]?.label, "shared-x: database configured");
  assert.equal(result.steps[0]?.status, "fail");
});

test("shared X readiness: healthy pooled twitterapi source passes", async () => {
  const result = await runSharedXReadinessProbe({
    env: {
      DATABASE_URL: "postgresql://example",
      TWITTERAPI_IO_API_KEY: "twio-key",
    },
    pool: {
      query: async () => ({
        rows: [{
          enabled: true,
          config: {
            provider: "twitterapi_io",
            monthly_budget_usd: 10,
            rules: [
              {
                id: "hiring_core",
                name: "X hiring core",
                query: "\"we're hiring\" lang:en -is:retweet",
                signal_kind: "hiring",
                limit: 15,
                cadence_hours: 6,
              },
            ],
          },
        }],
      }),
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "twitterapi_io");
  assert.equal(result.enabledRuleCount, 1);
  assert.equal(result.projectedMonthlyCostUsd, 0.27);
});

test("shared X readiness: missing provider key fails explicitly", async () => {
  const result = await runSharedXReadinessProbe({
    env: {
      DATABASE_URL: "postgresql://example",
    },
    pool: {
      query: async () => ({
        rows: [{
          enabled: true,
          config: {
            provider: "twitterapi_io",
            monthly_budget_usd: 10,
            rules: [
              {
                id: "launch_core",
                name: "X launch core",
                query: "\"launching today\" lang:en -is:retweet",
                signal_kind: "product_launch",
                limit: 15,
                cadence_hours: 6,
              },
            ],
          },
        }],
      }),
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, false);
  const providerKey = result.steps.find((step) => step.label === "shared-x: provider key present");
  assert.equal(providerKey?.status, "fail");
  assert.match(providerKey?.detail ?? "", /TWITTERAPI_IO_API_KEY/);
});

test("shared X readiness: over-budget rule pack fails", async () => {
  const result = await runSharedXReadinessProbe({
    env: {
      DATABASE_URL: "postgresql://example",
      TWITTERAPI_IO_API_KEY: "twio-key",
    },
    pool: {
      query: async () => ({
        rows: [{
          enabled: true,
          config: {
            provider: "twitterapi_io",
            monthly_budget_usd: 0.5,
            rules: [
              {
                id: "dense_rule",
                name: "Dense rule",
                query: "\"switching from\" lang:en -is:retweet",
                signal_kind: "competitor_move",
                limit: 25,
                cadence_hours: 4,
              },
            ],
          },
        }],
      }),
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, false);
  const budget = result.steps.find((step) => step.label === "shared-x: monthly budget");
  assert.equal(budget?.status, "fail");
  assert.match(budget?.detail ?? "", /Projected \$0\.67\/mo against cap \$0\.50\/mo/);
});
