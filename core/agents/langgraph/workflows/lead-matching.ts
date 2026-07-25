import type { EventBus } from "../../../substrate/events/index.ts";
import {
  defineWorkflow,
  type WorkflowDefinition,
} from "../../../substrate/workflows/index.ts";
import {
  runLeadMatchingGraphInWorkflowStep,
  type LeadMatchingDecision,
  type LeadMatchingGraphInput,
} from "../graphs/lead-matching.ts";
import type { BombsellLangGraphState } from "../state.ts";

export const WORKSPACE_SIGNAL_MATCHING_WORKFLOW = "workspace.signal.matching";
export const SIGNAL_MATCHING_BUDGET_RETRY_DELAY_MS = 24 * 60 * 60_000;
export const SIGNAL_MATCHING_BUDGET_MAX_RETRIES = 3;

export function createWorkspaceSignalMatchingWorkflow(opts: {
  bus?: EventBus;
  budgetRetryDelayMs?: number;
  budgetMaxRetries?: number;
} = {}): WorkflowDefinition<LeadMatchingGraphInput, BombsellLangGraphState> {
  const retryDelayMs = Math.max(
    0,
    Math.trunc(opts.budgetRetryDelayMs ?? SIGNAL_MATCHING_BUDGET_RETRY_DELAY_MS),
  );
  const maxRetries = Math.max(
    0,
    Math.trunc(opts.budgetMaxRetries ?? SIGNAL_MATCHING_BUDGET_MAX_RETRIES),
  );
  return defineWorkflow<LeadMatchingGraphInput, BombsellLangGraphState>({
    name: WORKSPACE_SIGNAL_MATCHING_WORKFLOW,
    version: "1",
    async run(input, ctx) {
      const baseThreadId = input.thread_id ??
        `signal-match:${input.workspace_id ?? ctx.workspace_id}:${input.signal_id}`;
      let output: BombsellLangGraphState | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        output = await runLeadMatchingGraphInWorkflowStep({
          ctx,
          input: {
            ...input,
            thread_id: `${baseThreadId}:budget-attempt-${attempt + 1}`,
          },
          bus: opts.bus,
          step_name: `langgraph:lead.matching_graph.v1:budget-attempt-${attempt + 1}`,
        });
        const decision = output.attributes?.lead_matching as
          | LeadMatchingDecision
          | undefined;
        if (decision?.next_action !== "wait_for_budget" || attempt === maxRetries) {
          return output;
        }
        await ctx.sleep(retryDelayMs);
      }
      return output!;
    },
  });
}
