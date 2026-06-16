import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runSourceDiscoveryGraphInWorkflowStep,
  type SourceDiscoveryGraphInput,
} from "../graphs/source-discovery.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_SOURCE_DISCOVERY_WORKFLOW = "workspace.source.discovery";

export function createWorkspaceSourceDiscoveryWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<SourceDiscoveryGraphInput, BombsellLangGraphState> {
  return defineWorkflow<SourceDiscoveryGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_SOURCE_DISCOVERY_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runSourceDiscoveryGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
