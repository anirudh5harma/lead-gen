import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runCampaignStrategyGraphInWorkflowStep,
  type CampaignStrategyGraphInput,
} from "../graphs/campaign-strategy.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_CAMPAIGN_STRATEGY_WORKFLOW = "workspace.campaign.strategy";

export function createWorkspaceCampaignStrategyWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<CampaignStrategyGraphInput, BombsellLangGraphState> {
  return defineWorkflow<CampaignStrategyGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_CAMPAIGN_STRATEGY_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runCampaignStrategyGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
