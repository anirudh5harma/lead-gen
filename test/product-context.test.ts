import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatProfileIntelligence,
  formatRecommendationQuality,
} from "../core/product/context.ts";

test("product context includes Exa-enriched profile intelligence", () => {
  const markdown = formatProfileIntelligence({
    company_id: "00000000-0000-4000-8000-000000000001",
    company_name: "Acme GTM",
    domain: "acmegtm.example",
    website_url: "https://acmegtm.example",
    industry: "AI GTM",
    description: "Helps lean teams find buying signals.",
    exa_summary: "Acme appears in competitor and category conversations.",
    exa_source_domains: ["g2.com", "producthunt.com"],
    exa_market_terms: ["category", "competitor", "signals"],
    exa_positioning_notes: ["Acme is discussed as an AI GTM workspace for lean teams."],
    exa_competitor_mentions: ["Acme GTM alternatives"],
    exa_audience_terms: ["gtm teams", "sales teams"],
    exa_proof_points: ["Buyers compare Acme with outbound automation tools."],
    exa_evidence_cards: [{
      title: "Acme GTM alternatives",
      url: "https://g2.com/acme",
      source_domain: "g2.com",
      snippet: "Buyers compare Acme with outbound automation tools.",
      published_at: null,
    }],
    exa_evidence_source_ids: [
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ],
    exa_result_count: 6,
    exa_enriched_at: "2026-06-03T12:00:00.000Z",
    vertical_intelligence: null,
  });

  assert.match(markdown, /Company: Acme GTM/);
  assert.match(markdown, /Public-web summary: Acme appears/);
  assert.match(markdown, /Market terms: category, competitor, signals/);
  assert.match(markdown, /Positioning: Acme is discussed/);
  assert.match(markdown, /Audience: gtm teams, sales teams/);
  assert.match(markdown, /Competitors: Acme GTM alternatives/);
  assert.match(markdown, /Proof points: Buyers compare Acme/);
  assert.match(markdown, /Source domains: g2.com, producthunt.com/);
  assert.match(markdown, /Evidence: 2 sources, 6 Exa results/);
});

test("product context summarizes Exa recommendation learning", () => {
  const markdown = formatRecommendationQuality({
    total_reviewed: 5,
    accepted: 3,
    ignored: 2,
    acceptance_rate: 0.6,
    last_reviewed_at: "2026-06-04T10:00:00.000Z",
    content_opportunity: {
      total_reviewed: 3,
      accepted: 2,
      ignored: 1,
      acceptance_rate: 0.67,
      last_reviewed_at: "2026-06-04T10:00:00.000Z",
    },
    aeo_gap: {
      total_reviewed: 2,
      accepted: 1,
      ignored: 1,
      acceptance_rate: 0.5,
      last_reviewed_at: "2026-06-04T09:00:00.000Z",
    },
  });

  assert.match(markdown, /All recommendations: reviewed=5 kept=3 skipped=2 keep_rate=60%/);
  assert.match(markdown, /Content opportunities: reviewed=3 kept=2 skipped=1 keep_rate=67%/);
  assert.match(markdown, /AEO gaps: reviewed=2 kept=1 skipped=1 keep_rate=50%/);
});
