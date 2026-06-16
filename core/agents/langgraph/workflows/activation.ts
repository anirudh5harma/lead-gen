import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runActivationSetupGraphInWorkflowStep,
  type ActivationSetupGraphInput,
} from "../graphs/activation.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_ACTIVATION_SETUP_WORKFLOW = "workspace.activation.setup";

export function createWorkspaceActivationSetupWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<ActivationSetupGraphInput, BombsellLangGraphState> {
  return defineWorkflow<ActivationSetupGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_ACTIVATION_SETUP_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runActivationSetupGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
