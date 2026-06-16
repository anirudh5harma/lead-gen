import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runReplyTriageGraphInWorkflowStep,
  type ReplyTriageGraphInput,
} from "../graphs/reply-triage.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_REPLY_TRIAGE_WORKFLOW = "workspace.reply.triage";

export function createWorkspaceReplyTriageWorkflow(opts: {
  bus?: EventBus;
} = {}): WorkflowDefinition<ReplyTriageGraphInput, BombsellLangGraphState> {
  return defineWorkflow<ReplyTriageGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_REPLY_TRIAGE_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      return runReplyTriageGraphInWorkflowStep({
        ctx,
        input,
        bus: opts.bus,
      });
    },
  });
}
