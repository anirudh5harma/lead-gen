import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runCompanyBrainBriefGraphInWorkflowStep,
  runCompanyBrainRecallGraphInWorkflowStep,
  type CompanyBrainGraphInput,
} from "../graphs/company-brain.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_COMPANY_BRAIN_RECALL_WORKFLOW = "workspace.company_brain.recall";
export const WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW = "workspace.company_brain.brief";

export function createWorkspaceCompanyBrainRecallWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<CompanyBrainGraphInput, BombsellLangGraphState> {
  return defineWorkflow<CompanyBrainGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_COMPANY_BRAIN_RECALL_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runCompanyBrainRecallGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}

export function createWorkspaceCompanyBrainBriefWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<CompanyBrainGraphInput, BombsellLangGraphState> {
  return defineWorkflow<CompanyBrainGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_COMPANY_BRAIN_BRIEF_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runCompanyBrainBriefGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
