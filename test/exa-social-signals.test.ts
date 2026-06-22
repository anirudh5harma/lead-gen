import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExaSocialSignalQuery,
  defaultExaSocialIntentsForSignalKind,
  exaSocialFreshnessStartDate,
  exaSocialPlatformDomains,
} from "../core/exa/social-signals.ts";

test("exa social helpers: platform domains cover X and LinkedIn", () => {
  assert.deepEqual(exaSocialPlatformDomains(["x"]), []);
  assert.deepEqual(exaSocialPlatformDomains(["linkedin"]), ["linkedin.com"]);
  assert.deepEqual(
    exaSocialPlatformDomains(["x", "linkedin"]),
    ["linkedin.com"],
  );
});

test("exa social helpers: default intents follow signal kind", () => {
  assert.deepEqual(defaultExaSocialIntentsForSignalKind("hiring"), ["hiring"]);
  assert.deepEqual(
    defaultExaSocialIntentsForSignalKind("product_launch"),
    ["product_launch", "feature_release"],
  );
  assert.deepEqual(
    defaultExaSocialIntentsForSignalKind("competitor_move"),
    ["buyer_intent"],
  );
});

test("exa social helpers: generated queries stay social, fresh, and keyword-rich", () => {
  const result = buildExaSocialSignalQuery({
    company_name: "Acme",
    industry: "AI infrastructure",
    signal_keywords: "revops, outbound automation",
    competitor_watchlist: "Apollo, ZoomInfo",
    linkedin_signal_behaviors: "company page posts, founder updates",
    platforms: ["x", "linkedin"],
    intents: ["hiring", "funding", "feature_release"],
    freshness_days: 7,
  });

  assert.equal(result.source_name, "Exa X/Twitter and LinkedIn signal posts");
  assert.deepEqual(result.platforms, ["x", "linkedin"]);
  assert.deepEqual(result.include_domains, ["linkedin.com"]);
  assert.match(result.query, /Latest public posts on X\/Twitter and LinkedIn from the last 7 days/i);
  assert.match(result.query, /hiring announcements/i);
  assert.match(result.query, /fundraising announcements/i);
  assert.match(result.query, /"we're hiring"/i);
  assert.match(result.query, /"raised seed"/i);
  assert.match(result.query, /"new feature"/i);
  assert.match(result.query, /"Apollo"/);
  assert.match(result.query, /"company page posts"/);
});

test("exa social helpers: freshness start dates clamp to a recent ISO window", () => {
  assert.equal(
    exaSocialFreshnessStartDate(7, new Date("2026-06-22T00:00:00.000Z")),
    "2026-06-15T00:00:00.000Z",
  );
  assert.equal(
    exaSocialFreshnessStartDate(99, new Date("2026-06-22T00:00:00.000Z")),
    "2026-05-23T00:00:00.000Z",
  );
});
