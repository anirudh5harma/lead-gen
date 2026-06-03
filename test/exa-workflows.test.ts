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
