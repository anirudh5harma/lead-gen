import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCampaignOutcomeLearningExemplar,
  campaignOutcomePatternKey,
} from "../core/product/campaign-learning.ts";

test("campaign outcome learning uses a stable Play-scoped pattern key", () => {
  assert.equal(
    campaignOutcomePatternKey("11111111-1111-4111-8111-111111111111"),
    "play:11111111-1111-4111-8111-111111111111|stage:campaign_outcome",
  );
});

test("campaign outcome learning exemplar keeps only useful Play output", () => {
  const exemplar = buildCampaignOutcomeLearningExemplar({
    play_id: "11111111-1111-4111-8111-111111111111",
    play_run_id: "22222222-2222-4222-8222-222222222222",
    play_name: "Founder reply play",
    rep_name: "Prayog",
    outcome_kind: "opportunity_created",
    note: "Worked for founders hiring sales",
    output: {
      decision: "Use founder-led proof",
      lift: 0.42,
      ignored_blob: { too: "large" },
      steps: ["Find trigger", "Send compact proof"],
    },
  });

  assert.equal(exemplar.play_name, "Founder reply play");
  assert.equal(exemplar.rep_name, "Prayog");
  assert.equal(exemplar.outcome_kind, "opportunity_created");
  assert.equal(exemplar.note, "Worked for founders hiring sales");
  assert.deepEqual(exemplar.output, {
    decision: "Use founder-led proof",
    lift: 0.42,
    steps: ["Find trigger", "Send compact proof"],
  });
  assert.match(String(exemplar.guidance), /Prayog campaign exemplar/);
});
