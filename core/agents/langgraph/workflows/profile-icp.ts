import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runProfileIcpGraphInWorkflowStep,
  type ProfileIcpGraphInput,
} from "../graphs/profile-icp.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_PROFILE_ICP_WORKFLOW = "workspace.profile.icp";

export function createWorkspaceProfileIcpWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<ProfileIcpGraphInput, BombsellLangGraphState> {
  return defineWorkflow<ProfileIcpGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_PROFILE_ICP_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runProfileIcpGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
