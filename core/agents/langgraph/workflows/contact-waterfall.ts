import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runContactWaterfallGraphInWorkflowStep,
  type ContactWaterfallGraphInput,
} from "../graphs/contact-waterfall.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_CONTACT_WATERFALL_WORKFLOW = "workspace.contact.waterfall";

export function createWorkspaceContactWaterfallWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<ContactWaterfallGraphInput, BombsellLangGraphState> {
  return defineWorkflow<ContactWaterfallGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_CONTACT_WATERFALL_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runContactWaterfallGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
