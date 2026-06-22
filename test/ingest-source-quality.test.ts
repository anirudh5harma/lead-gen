import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSignalQualityMetadata } from "../core/ingest/source-quality.ts";

test("source quality: fresh official GTM hiring is high intent and urgent", () => {
  const quality = deriveSignalQualityMetadata({
    adapter_id: "greenhouse",
    source_name: "Acme Greenhouse hiring",
    source_config: {
      source_tier: "official",
      source_authority: 0.95,
      company_domain: "acme.example",
    },
    item: {
      external_id: "job_1",
      title: "Founding VP Sales",
      content: "Lead GTM expansion after our Series A.",
      url: "https://boards.greenhouse.io/acme/jobs/1?utm_source=rss",
      kind: "hiring",
      structured: { function: "sales", seniority: "vp" },
      freshness_at: "2026-06-16T07:00:00.000Z",
    },
    kind: "hiring",
    now: new Date("2026-06-16T09:00:00.000Z"),
  });

  assert.equal(quality.properties.source_tier, "official");
  assert.equal(quality.properties.source_authority, 0.95);
  assert.equal(quality.properties.canonical_url, "https://boards.greenhouse.io/acme/jobs/1");
  assert.equal(
    (quality.properties.source_credibility as { tier?: string }).tier,
    "official",
  );
  assert.equal(
    (quality.properties.buying_intent as { level?: string }).level,
    "high",
  );
  assert.equal(
    (quality.properties.timing as { conversion_window?: string }).conversion_window,
    "now",
  );
  assert.equal(
    (quality.properties.signal_quality as { level?: string }).level,
    "high",
  );
  assert.equal(quality.provenance.quality_model, "signal_quality.v1");
});

test("source quality: stale aggregator results lose timing urgency", () => {
  const quality = deriveSignalQualityMetadata({
    adapter_id: "google_news",
    source_name: "Acme market news",
    source_config: { source_tier: "aggregator" },
    item: {
      external_id: "news_1",
      title: "Acme mentioned in a market roundup",
      content: "A broad roundup of AI vendors.",
      url: "https://news.example/article?utm_campaign=test",
      kind: "press_mention",
      freshness_at: "2026-05-01T00:00:00.000Z",
    },
    kind: "press_mention",
    now: new Date("2026-06-16T09:00:00.000Z"),
  });

  assert.equal(quality.properties.source_tier, "aggregator");
  assert.equal(quality.properties.source_authority, 0.66);
  assert.equal(
    (quality.properties.buying_intent as { level?: string }).level,
    "low",
  );
  assert.equal(
    (quality.properties.timing as { conversion_window?: string }).conversion_window,
    "stale",
  );
  assert.notEqual(
    (quality.properties.signal_quality as { level?: string }).level,
    "high",
  );
});

test("source quality: projected source tier is used when config tier is invalid", () => {
  const quality = deriveSignalQualityMetadata({
    adapter_id: "rss",
    source_name: "Acme updates",
    source_config: {
      source_tier: "definitely-not-valid",
      company_domain: "acme.example",
    },
    source_properties: {
      source_tier: "official",
      source_authority: 0.93,
    },
    item: {
      external_id: "rss_1",
      title: "Acme launches a migration guide",
      content: "A new guide for teams switching from legacy outbound tools.",
      url: "https://acme.example/blog/migration-guide",
      kind: "product_launch",
      freshness_at: "2026-06-16T08:30:00.000Z",
    },
    kind: "product_launch",
    now: new Date("2026-06-16T09:00:00.000Z"),
  });

  assert.equal(quality.properties.source_tier, "official");
  assert.equal(quality.properties.source_authority, 0.93);
  assert.equal(
    (quality.properties.source_credibility as { tier?: string }).tier,
    "official",
  );
});

test("source quality: direct social company context boosts authority and intent", () => {
  const quality = deriveSignalQualityMetadata({
    adapter_id: "exa",
    source_name: "Exa LinkedIn hiring posts",
    source_config: { source_tier: "aggregator" },
    item: {
      external_id: "social_1",
      title: "Acme is hiring a founding AE",
      content: "We are hiring a founding AE and revops lead.",
      url: "https://www.linkedin.com/posts/acme_hiring-activity-123",
      kind: "hiring",
      structured: {
        source: "social",
        platform: "linkedin",
        author_name: "Acme",
        author_kind: "company",
        company_name: "Acme",
        company_domain: "acme.example",
        matched_keywords: ["we are hiring", "founding ae"],
      },
      freshness_at: "2026-06-16T08:30:00.000Z",
    },
    kind: "hiring",
    now: new Date("2026-06-16T09:00:00.000Z"),
  });

  assert.equal(quality.properties.source_tier, "aggregator");
  assert.equal(quality.properties.source_authority, 0.92);
  assert.equal(
    (quality.properties.buying_intent as { level?: string }).level,
    "high",
  );
  assert.match(
    JSON.stringify((quality.properties.source_credibility as { reasons?: unknown }).reasons),
    /linked to a tracked company via linkedin metadata/i,
  );
});
