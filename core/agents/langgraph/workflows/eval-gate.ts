import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runEvalGateGraphInWorkflowStep,
  type EvalGateGraphInput,
} from "../graphs/eval-gate.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_EVAL_GATE_WORKFLOW = "workspace.eval.gate";

export function createWorkspaceEvalGateWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<EvalGateGraphInput, BombsellLangGraphState> {
  return defineWorkflow<EvalGateGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_EVAL_GATE_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runEvalGateGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
