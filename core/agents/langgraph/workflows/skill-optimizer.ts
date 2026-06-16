import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runSkillOptimizerGraphInWorkflowStep,
  type SkillOptimizerGraphInput,
} from "../graphs/skill-optimizer.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_SKILL_OPTIMIZER_WORKFLOW = "workspace.skill.optimizer";

export function createWorkspaceSkillOptimizerWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<SkillOptimizerGraphInput, BombsellLangGraphState> {
  return defineWorkflow<SkillOptimizerGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_SKILL_OPTIMIZER_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runSkillOptimizerGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
