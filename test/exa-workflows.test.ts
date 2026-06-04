import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExaAeoAuditWorkflow,
  createExaBriefRefreshWorkflow,
  createExaContentOpportunityWorkflow,
  createExaDraftGroundingWorkflow,
  createExaOpenWebSignalWorkflow,
  createExaProfileBootstrapWorkflow,
  createExaRepResearchWorkflow,
  EXA_AEO_AUDIT_WORKFLOW,
  EXA_BRIEF_REFRESH_WORKFLOW,
  EXA_CONTENT_OPPORTUNITY_WORKFLOW,
  EXA_DRAFT_GROUNDING_WORKFLOW,
  EXA_OPEN_WEB_SIGNAL_WORKFLOW,
  EXA_PROFILE_BOOTSTRAP_WORKFLOW,
  EXA_REP_RESEARCH_WORKFLOW,
} from "../core/exa/workflows.ts";
import { eventRegistry } from "../core/substrate/events/registry.ts";

test("Exa workflows expose the product intelligence service contract", () => {
  const workflows = [
    createExaProfileBootstrapWorkflow(),
    createExaBriefRefreshWorkflow(),
    createExaRepResearchWorkflow(),
    createExaDraftGroundingWorkflow(),
    createExaContentOpportunityWorkflow(),
    createExaAeoAuditWorkflow(),
    createExaOpenWebSignalWorkflow(),
  ];

  assert.deepEqual(
    workflows.map((workflow) => workflow.name),
    [
      EXA_PROFILE_BOOTSTRAP_WORKFLOW,
      EXA_BRIEF_REFRESH_WORKFLOW,
      EXA_REP_RESEARCH_WORKFLOW,
      EXA_DRAFT_GROUNDING_WORKFLOW,
      EXA_CONTENT_OPPORTUNITY_WORKFLOW,
      EXA_AEO_AUDIT_WORKFLOW,
      EXA_OPEN_WEB_SIGNAL_WORKFLOW,
    ],
  );
  assert.deepEqual(
    workflows.map((workflow) => workflow.version),
    ["1", "1", "1", "1", "1", "1", "1"],
  );
});

test("Exa event contract includes content fetch provenance", () => {
  const parsed = eventRegistry["exa.contents.fetched"].parse({
    request_id: "req_123",
    ids: ["exa_result_1"],
    urls: ["https://example.com/proof"],
    result_count: 1,
  });

  assert.equal(parsed.result_count, 1);
  assert.deepEqual(parsed.urls, ["https://example.com/proof"]);
});

test("Exa event contract includes Brief refresh output", () => {
  const parsed = eventRegistry["rep.brief.refreshed"].parse({
    query: "Acme market changes",
    request_id: "req_123",
    evidence_source_ids: ["00000000-0000-4000-8000-000000000001"],
    summary: "1. Evidence",
    result_count: 1,
    notes: [{
      title: "New proof",
      detail: "A public-web source changed.",
      evidence_source_ids: ["00000000-0000-4000-8000-000000000001"],
    }],
    review_items: [],
    recent_changes: [],
    quiet_exceptions: [],
  });

  assert.equal(parsed.notes[0]?.title, "New proof");
});

test("Exa event contract includes Content and AEO review projections", () => {
  const evidence = ["00000000-0000-4000-8000-000000000001"];
  const content = eventRegistry["content.opportunity.discovered"].parse({
    query: "buyer questions",
    request_id: "req_content",
    evidence_source_ids: evidence,
    summary: "content summary",
    result_count: 1,
    opportunities: [{
      title: "Pricing objection angle",
      detail: "Market evidence suggests a buyer question.",
      url: "https://example.com/pricing",
      evidence_source_ids: evidence,
    }],
    review_items: [{
      title: "Pricing objection angle",
      detail: "Review this content angle.",
      evidence_source_ids: evidence,
    }],
  });
  const aeo = eventRegistry["aeo.audit.completed"].parse({
    query: "category answers",
    request_id: "req_aeo",
    evidence_source_ids: evidence,
    summary: "aeo summary",
    result_count: 1,
    gaps: [{
      title: "Comparison answer gap",
      detail: "Answer visibility gap to review.",
      url: "https://example.com/compare",
      evidence_source_ids: evidence,
    }],
    review_items: [{
      title: "Comparison answer gap",
      detail: "Review this answer gap.",
      evidence_source_ids: evidence,
    }],
  });

  assert.equal(content.opportunities?.[0]?.title, "Pricing objection angle");
  assert.equal(aeo.gaps?.[0]?.title, "Comparison answer gap");
});

test("Exa recommendation feedback is a typed review event", () => {
  const parsed = eventRegistry["recommendation.reviewed"].parse({
    review_id:
      "content_opportunity:00000000-0000-4000-8000-000000000010:abc123",
    review_kind: "content_opportunity",
    source_event_id: "00000000-0000-4000-8000-000000000010",
    decision: "accepted",
    note: "Use this in the next content pass.",
    item: {
      title: "Pricing objection angle",
      detail: "Market evidence suggests a buyer question.",
      url: "https://example.com/pricing",
      evidence_source_ids: ["00000000-0000-4000-8000-000000000001"],
    },
  });

  assert.equal(parsed.decision, "accepted");
  assert.equal(parsed.item.title, "Pricing objection angle");
});

test("Exa query events carry typed procedural query plans", () => {
  const parsed = eventRegistry["exa.query.requested"].parse({
    query:
      "AI GTM buyer questions operator kept evidence patterns: Buyer comparison angle",
    original_query: "AI GTM buyer questions",
    intent: "content_research",
    query_plan: {
      source: "procedural_memory",
      pattern_key: "recommendation:content_opportunity|stage:exa_review",
      exemplar_ids: ["00000000-0000-4000-8000-000000000101"],
      kept_examples: ["Buyer comparison angle"],
      skipped_examples: ["Generic launch recap"],
    },
  });

  assert.equal(parsed.query_plan?.source, "procedural_memory");
  assert.equal(parsed.original_query, "AI GTM buyer questions");
});
