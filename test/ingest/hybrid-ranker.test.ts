import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeHybridScore,
  graphProximityFromEvidence,
  intentPriorFromCompositeScore,
  rankHybridCandidates,
} from "../../core/ingest/hybrid-ranker.ts";

test("hybrid ranker: higher vector similarity ranks higher", () => {
  const ranked = rankHybridCandidates([
    {
      candidate_id: "icp-low",
      vec_sim: 0.42,
      graph_prox: 0.1,
      intent_prior: 0.2,
      passed_must_haves: true,
    },
    {
      candidate_id: "icp-high",
      vec_sim: 0.91,
      graph_prox: 0.1,
      intent_prior: 0.2,
      passed_must_haves: true,
    },
  ]);

  assert.deepEqual(ranked.map((candidate) => candidate.candidate_id), [
    "icp-high",
    "icp-low",
  ]);
  assert.ok(ranked[0]!.hybrid_score > ranked[1]!.hybrid_score);
});

test("hybrid ranker: graph proximity boost raises rank", () => {
  const noEdge = graphProximityFromEvidence({
    same_company_match_count: 0,
    same_company_kind_match_count: 0,
    has_related_company_link: false,
  });
  const withEdge = graphProximityFromEvidence({
    same_company_match_count: 1,
    same_company_kind_match_count: 1,
    has_related_company_link: true,
  });
  const ranked = rankHybridCandidates([
    {
      candidate_id: "without-edge",
      vec_sim: 0.7,
      graph_prox: noEdge,
      intent_prior: 0.2,
      passed_must_haves: true,
    },
    {
      candidate_id: "with-edge",
      vec_sim: 0.7,
      graph_prox: withEdge,
      intent_prior: 0.2,
      passed_must_haves: true,
    },
  ]);

  assert.ok(withEdge > noEdge);
  assert.equal(ranked[0]!.candidate_id, "with-edge");
});

test("hybrid ranker: higher account intent prior raises hybrid score", () => {
  const lowIntent = intentPriorFromCompositeScore(0.1);
  const highIntent = intentPriorFromCompositeScore(2.4);
  const ranked = rankHybridCandidates([
    {
      candidate_id: "low-intent",
      vec_sim: 0.64,
      graph_prox: 0.2,
      intent_prior: lowIntent,
      passed_must_haves: true,
    },
    {
      candidate_id: "high-intent",
      vec_sim: 0.64,
      graph_prox: 0.2,
      intent_prior: highIntent,
      passed_must_haves: true,
    },
  ]);

  assert.ok(highIntent > lowIntent);
  assert.ok(ranked[0]!.hybrid_score > ranked[1]!.hybrid_score);
  assert.equal(ranked[0]!.candidate_id, "high-intent");
});

test("hybrid ranker: equal scores resolve by alphabetical candidate id", () => {
  const ranked = rankHybridCandidates([
    {
      candidate_id: "icp-zeta",
      vec_sim: 0.5,
      graph_prox: 0.2,
      intent_prior: 0.3,
      passed_must_haves: true,
    },
    {
      candidate_id: "icp-alpha",
      vec_sim: 0.5,
      graph_prox: 0.2,
      intent_prior: 0.3,
      passed_must_haves: true,
    },
  ]);

  assert.deepEqual(ranked.map((candidate) => candidate.candidate_id), [
    "icp-alpha",
    "icp-zeta",
  ]);
  assert.equal(ranked[0]!.hybrid_score, ranked[1]!.hybrid_score);
});

test("hybrid ranker: failing must-haves are excluded before scoring", () => {
  const excludedScore = computeHybridScore({
    vec_sim: 0.99,
    graph_prox: 0.99,
    intent_prior: 0.99,
    passed_must_haves: false,
  });
  const ranked = rankHybridCandidates([
    {
      candidate_id: "excluded",
      vec_sim: 0.99,
      graph_prox: 0.99,
      intent_prior: 0.99,
      passed_must_haves: false,
    },
    {
      candidate_id: "included",
      vec_sim: 0.1,
      graph_prox: 0.1,
      intent_prior: 0.1,
      passed_must_haves: true,
    },
  ]);

  assert.equal(excludedScore, 0);
  assert.deepEqual(ranked.map((candidate) => candidate.candidate_id), ["included"]);
});
