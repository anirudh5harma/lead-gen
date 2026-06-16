import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runMessagePersonalizationGraphInWorkflowStep,
  type MessagePersonalizationGraphInput,
} from "../graphs/message-personalization.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_MESSAGE_PERSONALIZATION_WORKFLOW =
  "workspace.message.personalization";

export function createWorkspaceMessagePersonalizationWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<MessagePersonalizationGraphInput, BombsellLangGraphState> {
  return defineWorkflow<MessagePersonalizationGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_MESSAGE_PERSONALIZATION_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runMessagePersonalizationGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
