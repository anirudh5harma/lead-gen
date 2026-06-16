import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runVerticalIntelligenceGraphInWorkflowStep,
  type VerticalIntelligenceGraphInput,
} from "../graphs/vertical-intelligence.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_VERTICAL_INTELLIGENCE_WORKFLOW =
  "workspace.vertical_intelligence.refresh";

export function createWorkspaceVerticalIntelligenceWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<VerticalIntelligenceGraphInput, BombsellLangGraphState> {
  return defineWorkflow<VerticalIntelligenceGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_VERTICAL_INTELLIGENCE_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runVerticalIntelligenceGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
