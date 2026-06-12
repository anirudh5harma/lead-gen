import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSignalCompanyHint } from "../core/ingest/workspace-discovery.ts";

test("workspace discovery company hints: derives Product Hunt company from structured launch fields", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "product_hunt",
    source_name: "Product Hunt",
    source_config: {},
    item: {
      title: "Bombsell - AI-native GTM",
      content: "Find buying signals and send grounded outreach.",
      url: "https://www.producthunt.com/posts/bombsell",
      freshness_at: "2026-06-12T00:00:00.000Z",
      structured: {
        name: "Bombsell",
        tagline: "AI-native GTM",
        website: "https://www.bombsell.com/?ref=producthunt",
      },
    },
  });

  assert.deepEqual(hint, {
    name: "Bombsell",
    domain: "bombsell.com",
    description: "AI-native GTM",
    source: "product_hunt",
    confidence: "derived",
  });
});

test("workspace discovery company hints: keeps Product Hunt launch name when only redirect URL is present", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "product_hunt",
    source_name: "Product Hunt",
    source_config: {},
    item: {
      title: "LaunchCo - outbound copilot",
      content: "Find qualified signals.",
      url: "https://www.producthunt.com/posts/launchco",
      freshness_at: "2026-06-12T00:00:00.000Z",
      structured: {
        name: "LaunchCo",
        tagline: "Outbound copilot",
        website: "https://www.producthunt.com/r/launchco",
      },
    },
  });

  assert.deepEqual(hint, {
    name: "LaunchCo",
    domain: null,
    description: "Outbound copilot",
    source: "product_hunt",
    confidence: "derived",
  });
});

test("workspace discovery company hints: derives HN Who's Hiring company from title and hiring URL", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "hn_whos_hiring",
    source_name: "Hacker News Who's Hiring",
    source_config: {},
    item: {
      title:
        "Wrenly | Founding Customer Success Manager | San Francisco | https://www.wrenly.ai/hiring/csm",
      content: "We are hiring a founding CSM to work with early design partners.",
      url: "https://news.ycombinator.com/item?id=1",
      freshness_at: "2026-06-12T00:00:00.000Z",
      structured: {
        author: "founder",
        thread_id: "1",
      },
    },
  });

  assert.deepEqual(hint, {
    name: "Wrenly",
    domain: "wrenly.ai",
    description: "We are hiring a founding CSM to work with early design partners.",
    source: "hn_whos_hiring",
    confidence: "derived",
  });
});

test("workspace discovery company hints: source config target company wins over provider payload", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "product_hunt",
    source_name: "Product Hunt",
    source_config: {
      target_company_name: "Acme",
      target_company_domain: "https://www.acme.ai/",
    },
    item: {
      title: "Different product",
      freshness_at: "2026-06-12T00:00:00.000Z",
      structured: {
        name: "Different product",
        website: "https://different.example",
      },
    },
  });

  assert.deepEqual(hint, {
    name: "Acme",
    domain: "acme.ai",
    description: null,
    source: "source_config",
    confidence: "explicit",
  });
});

test("workspace discovery company hints: accepts explicit nested company object", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "webhook",
    source_name: "Push source",
    source_config: {},
    item: {
      title: "Beta hired a VP Sales",
      freshness_at: "2026-06-12T00:00:00.000Z",
      structured: {
        company: {
          name: "Beta Systems",
          domain: "beta-systems.co.uk",
          description: "Revenue intelligence platform",
        },
      },
    },
  });

  assert.deepEqual(hint, {
    name: "Beta Systems",
    domain: "beta-systems.co.uk",
    description: "Revenue intelligence platform",
    source: "structured_company",
    confidence: "explicit",
  });
});

test("workspace discovery company hints: rejects blocked publisher domains for linked-domain adapters", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "hn_front",
    source_name: "Hacker News",
    source_config: {},
    item: {
      title: "Launch HN: Example",
      url: "https://news.ycombinator.com/item?id=1",
      freshness_at: "2026-06-12T00:00:00.000Z",
      novelty_hint: { domain: "news.ycombinator.com" },
    },
  });

  assert.equal(hint, null);
});

test("workspace discovery company hints: derives linked target domains for HN and Reddit style signals", () => {
  const hint = deriveSignalCompanyHint({
    adapter_id: "reddit",
    source_name: "Reddit",
    source_config: {},
    item: {
      title: "Anyone using Acme?",
      url: "https://acme.ai/blog/new-workflow",
      freshness_at: "2026-06-12T00:00:00.000Z",
      structured: { domain: "acme.ai" },
      novelty_hint: { domain: "acme.ai" },
    },
  });

  assert.deepEqual(hint, {
    name: "Acme",
    domain: "acme.ai",
    description: null,
    source: "linked_domain",
    confidence: "derived",
  });
});
