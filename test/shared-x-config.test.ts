import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTrackedCompanyResolver,
  defaultSharedXSourceConfig,
  sharedXMonthlyCostEstimateUsd,
} from "../core/ingest/shared-x.ts";

test("shared X config: default pooled rule pack stays within the monthly budget cap", () => {
  const config = defaultSharedXSourceConfig();
  const estimate = sharedXMonthlyCostEstimateUsd(config);

  assert.equal(config.provider, "twitterapi_io");
  assert.ok(config.rules.length >= 10);
  assert.ok(estimate > 0);
  assert.ok(estimate <= config.monthly_budget_usd);
});

test("shared X config: tracked company resolver links by exact domain", () => {
  const resolver = createTrackedCompanyResolver([
    {
      id: "co_1",
      name: "Acme",
      domain: "acme.example",
      industry: null,
      size_bucket: null,
      greenhouse_id: null,
      lever_id: null,
      ashby_id: null,
      workable_id: null,
      career_rss_url: null,
      sec_cik: null,
      properties: {},
      added_at: "2026-06-22T00:00:00.000Z",
    },
  ]);

  const match = resolver.resolve({
    title: "Acme is hiring a founding AE",
    content: "We are growing the GTM team.",
    url: "https://x.com/acme/status/123",
    structured: {
      source: "social",
      platform: "x",
      company_domain: "https://www.acme.example/",
    },
  });

  assert.deepEqual(match, {
    company_id: "co_1",
    company_name: "Acme",
    company_domain: "acme.example",
    link_reason: "company_domain",
  });
});

test("shared X config: tracked company resolver links author/company names when domain is absent", () => {
  const resolver = createTrackedCompanyResolver([
    {
      id: "co_2",
      name: "LaunchCo",
      domain: null,
      industry: null,
      size_bucket: null,
      greenhouse_id: null,
      lever_id: null,
      ashby_id: null,
      workable_id: null,
      career_rss_url: null,
      sec_cik: null,
      properties: {},
      added_at: "2026-06-22T00:00:00.000Z",
    },
  ]);

  const match = resolver.resolve({
    title: "LaunchCo just launched a new workflow",
    content: "Now live for GTM teams.",
    url: "https://x.com/founder/status/456",
    structured: {
      source: "social",
      platform: "x",
      author_name: "LaunchCo",
    },
  });

  assert.deepEqual(match, {
    company_id: "co_2",
    company_name: "LaunchCo",
    company_domain: null,
    link_reason: "author_name",
  });
});
