import { END, START, StateGraph } from "@langchain/langgraph";
import type { EventBus } from "../../../substrate/events/index.ts";
import type { RunContext } from "../../../substrate/workflows/index.ts";
import {
  createLangGraphMemoryCheckpoint,
} from "../checkpoint.ts";
import {
  type BombsellLangGraphState,
  BombsellGraphStateAnnotation,
} from "../state.ts";
import {
  invokeLangGraphTool,
  type LangGraphToolOptions,
} from "../tools.ts";
import {
  runLangGraphInWorkflowStep,
  traceLangGraphNode,
} from "../runtime.ts";

export const EVAL_GATE_GRAPH_NAME = "eval.gate_graph.v1";

export type EvalGateArtifactKind = "draft" | "plan" | "post" | "reply" | "other";

export interface EvalGateSkillContext {
  skill_key: string;
  version: string;
  name: string;
  framework: string[];
  judge_focus: string[];
  slot_values?: Record<string, string>;
  pattern_key?: string;
  seed_pattern_key?: string | null;
}

export interface EvalGateGraphInput {
  workspace_id?: string;
  user_id: string;
  message_id: string;
  rep_id: string;
  channel: string;
  body: string;
  subject?: string | null;
  artifact_kind?: EvalGateArtifactKind;
  signal_summary?: string | null;
  counterparty_summary?: string | null;
  personalization_context_markdown?: string | null;
  workspace_context_markdown?: string | null;
  outreach_skill?: EvalGateSkillContext | null;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface EvalGateToolResult {
  workspace_id: string;
  message_id: string;
  rep_id: string;
  channel: string;
  decision: "pass" | "reject";
  eval_score: number;
  threshold: number;
  passed: boolean;
  notes: Record<string, unknown>;
  judged_event_id: string;
  rejected_event_id: string | null;
  rejection_reason: string | null;
  next_action: "continue_to_play_gate" | "revise_draft";
}

export interface EvalGateDecision {
  message_id: string;
  rep_id: string;
  channel: string;
  decision: "pass" | "reject";
  eval_score: number;
  passed: boolean;
  judged_event_id: string;
  rejected_event_id: string | null;
  rejection_reason: string | null;
  next_action: "continue_to_play_gate" | "revise_draft";
}

export interface EvalGateGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    evaluateDraft: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  evaluateDraft: "product.draft.eval.gate",
} as const;

export function createEvalGateGraph(opts: EvalGateGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: EVAL_GATE_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = evalGateInputFromState(state);
          return {
            rep_id: input.rep_id,
            attributes: mergeAttributes(state, {
              user_id: input.user_id,
              message_id: input.message_id,
              rep_id: input.rep_id,
              channel: input.channel,
              artifact_kind: input.artifact_kind ?? "draft",
            }),
          };
        },
      }),
    )
    .addNode(
      "evaluate",
      traceLangGraphNode({
        graph_name: EVAL_GATE_GRAPH_NAME,
        node_name: "evaluate",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const result = await invokeLangGraphTool<EvalGateToolResult>(
            tools.evaluateDraft,
            toolInputFromState(state),
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              eval_gate_result: result,
            }),
            tool_results: {
              eval_gate: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: EVAL_GATE_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<EvalGateToolResult>(state, "eval_gate_result");
          const decision = decisionFromEval(result);
          return {
            attributes: mergeAttributes(state, {
              eval_gate: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              eval_gate_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "evaluate")
    .addEdge("evaluate", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runEvalGateGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: EvalGateGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<EvalGateGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("eval gate graph requires a workspace_id");
  }
  const graph = createEvalGateGraph({
    ...opts.graphOptions,
    bus: opts.bus,
    toolOptions: {
      ...opts.graphOptions?.toolOptions,
      defaultContext: {
        ...opts.graphOptions?.toolOptions?.defaultContext,
        workspace_id,
        user_id: opts.input.user_id,
      },
    },
  });
  return runLangGraphInWorkflowStep({
    graph_name: EVAL_GATE_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      rep_id: opts.input.rep_id,
      message_id: opts.input.message_id,
      thread_id: opts.input.thread_id ?? `eval-gate:${workspace_id}:${opts.input.message_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: EVAL_GATE_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        message_id: opts.input.message_id,
        rep_id: opts.input.rep_id,
        channel: opts.input.channel,
        subject: opts.input.subject ?? null,
        body: opts.input.body,
        artifact_kind: opts.input.artifact_kind ?? "draft",
        signal_summary: opts.input.signal_summary ?? null,
        counterparty_summary: opts.input.counterparty_summary ?? null,
        personalization_context_markdown:
          opts.input.personalization_context_markdown ?? null,
        workspace_context_markdown: opts.input.workspace_context_markdown ?? null,
        outreach_skill: opts.input.outreach_skill ?? null,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromEval(result: EvalGateToolResult): EvalGateDecision {
  return {
    message_id: result.message_id,
    rep_id: result.rep_id,
    channel: result.channel,
    decision: result.decision,
    eval_score: result.eval_score,
    passed: result.passed,
    judged_event_id: result.judged_event_id,
    rejected_event_id: result.rejected_event_id,
    rejection_reason: result.rejection_reason,
    next_action: result.next_action,
  };
}

function toolInputFromState(state: BombsellLangGraphState): EvalGateGraphInput {
  const input = evalGateInputFromState(state);
  return {
    message_id: input.message_id,
    rep_id: input.rep_id,
    channel: input.channel,
    subject: input.subject ?? null,
    body: input.body,
    artifact_kind: input.artifact_kind ?? "draft",
    signal_summary: input.signal_summary ?? null,
    counterparty_summary: input.counterparty_summary ?? null,
    personalization_context_markdown:
      input.personalization_context_markdown ?? null,
    workspace_context_markdown: input.workspace_context_markdown ?? null,
    outreach_skill: input.outreach_skill ?? null,
  } as EvalGateGraphInput;
}

function evalGateInputFromState(state: BombsellLangGraphState): EvalGateGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: requiredString(state.attributes?.user_id, "user_id"),
    message_id: requiredString(state.attributes?.message_id ?? state.message_id, "message_id"),
    rep_id: requiredString(state.attributes?.rep_id ?? state.rep_id, "rep_id"),
    channel: requiredString(state.attributes?.channel, "channel"),
    subject: optionalString(state.attributes?.subject),
    body: requiredString(state.attributes?.body, "body"),
    artifact_kind: optionalArtifactKind(state.attributes?.artifact_kind),
    signal_summary: optionalString(state.attributes?.signal_summary),
    counterparty_summary: optionalString(state.attributes?.counterparty_summary),
    personalization_context_markdown:
      optionalString(state.attributes?.personalization_context_markdown),
    workspace_context_markdown: optionalString(state.attributes?.workspace_context_markdown),
    outreach_skill: optionalSkillContext(state.attributes?.outreach_skill),
  };
}

function getAttribute<T>(state: BombsellLangGraphState, key: string): T {
  const value = state.attributes?.[key];
  if (value == null) throw new Error(`missing graph attribute: ${key}`);
  return value as T;
}

function mergeAttributes(
  state: BombsellLangGraphState,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(state.attributes ?? {}), ...next };
}

function requiredString(value: unknown, key: string): string {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`eval gate graph requires ${key}`);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalArtifactKind(value: unknown): EvalGateArtifactKind | undefined {
  if (
    value === "draft" ||
    value === "plan" ||
    value === "post" ||
    value === "reply" ||
    value === "other"
  ) {
    return value;
  }
  return undefined;
}

function optionalSkillContext(value: unknown): EvalGateSkillContext | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EvalGateSkillContext>;
  if (
    typeof candidate.skill_key !== "string" ||
    typeof candidate.version !== "string" ||
    typeof candidate.name !== "string" ||
    !Array.isArray(candidate.framework) ||
    !Array.isArray(candidate.judge_focus)
  ) {
    return null;
  }
  return {
    skill_key: candidate.skill_key,
    version: candidate.version,
    name: candidate.name,
    framework: candidate.framework.filter((item): item is string => typeof item === "string"),
    judge_focus: candidate.judge_focus.filter((item): item is string => typeof item === "string"),
    slot_values: isStringRecord(candidate.slot_values) ? candidate.slot_values : undefined,
    pattern_key: optionalString(candidate.pattern_key) ?? undefined,
    seed_pattern_key: optionalString(candidate.seed_pattern_key),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((item) => typeof item === "string");
}
