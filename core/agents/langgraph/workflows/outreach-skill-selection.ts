import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runOutreachSkillSelectionGraphInWorkflowStep,
  type OutreachSkillSelectionGraphInput,
} from "../graphs/outreach-skill-selection.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_OUTREACH_SKILL_SELECTION_WORKFLOW = "workspace.outreach.skill_selection";

export function createWorkspaceOutreachSkillSelectionWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<OutreachSkillSelectionGraphInput, BombsellLangGraphState> {
  return defineWorkflow<OutreachSkillSelectionGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_OUTREACH_SKILL_SELECTION_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runOutreachSkillSelectionGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
