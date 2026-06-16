import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runLeadMatchingGraphInWorkflowStep,
  type LeadMatchingGraphInput,
} from "../graphs/lead-matching.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_SIGNAL_MATCHING_WORKFLOW = "workspace.signal.matching";

export function createWorkspaceSignalMatchingWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<LeadMatchingGraphInput, BombsellLangGraphState> {
  return defineWorkflow<LeadMatchingGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runLeadMatchingGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
