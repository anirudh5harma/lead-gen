import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runChannelReadinessGraphInWorkflowStep,
  type ChannelReadinessGraphInput,
} from "../graphs/channel-readiness.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_CHANNEL_READINESS_WORKFLOW = "workspace.channel.readiness";

export function createWorkspaceChannelReadinessWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<ChannelReadinessGraphInput, BombsellLangGraphState> {
  return defineWorkflow<ChannelReadinessGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_CHANNEL_READINESS_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runChannelReadinessGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
