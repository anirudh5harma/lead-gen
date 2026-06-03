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
