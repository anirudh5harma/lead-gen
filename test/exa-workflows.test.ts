import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createExaAeoAuditWorkflow,
  createExaContentOpportunityWorkflow,
  createExaDraftGroundingWorkflow,
  createExaOpenWebSignalWorkflow,
  createExaProfileBootstrapWorkflow,
  createExaRepResearchWorkflow,
  EXA_AEO_AUDIT_WORKFLOW,
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
      EXA_REP_RESEARCH_WORKFLOW,
      EXA_DRAFT_GROUNDING_WORKFLOW,
      EXA_CONTENT_OPPORTUNITY_WORKFLOW,
      EXA_AEO_AUDIT_WORKFLOW,
      EXA_OPEN_WEB_SIGNAL_WORKFLOW,
    ],
  );
  assert.deepEqual(
    workflows.map((workflow) => workflow.version),
    ["1", "1", "1", "1", "1", "1"],
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
