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

export const LEAD_MATCHING_GRAPH_NAME = "lead.matching_graph.v1";

type SignalMatchStatus = "matched" | "dismissed" | "skipped";
type SignalMatchSkipReason = "no_icps" | "budget" | "not_found" | "non_json" | "filtered";

export interface LeadMatchingGraphInput {
  workspace_id?: string;
  user_id: string;
  signal_id: string;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface LeadMatchingMatch {
  icp_segment: string;
  match_score: number;
  reason: string;
}

export interface LeadMatchingToolResult {
  workspace_id: string;
  signal_id: string;
  status: SignalMatchStatus;
  kind?: string | null;
  matched_icp_ids: string[];
  match_score: number | null;
  match_reason: string | null;
  matches: LeadMatchingMatch[];
  skip_reason?: SignalMatchSkipReason | null;
}

export interface LeadMatchingDecision {
  signal_id: string;
  status: SignalMatchStatus;
  ranked_matches: LeadMatchingMatch[];
  match_score: number | null;
  match_reason: string | null;
  contact_resolution_ready: boolean;
  next_action:
    | "resolve_contacts"
    | "wait_for_budget"
    | "configure_icp"
    | "review_signal"
    | "skip";
}

export interface LeadMatchingGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    signalMatch: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  signalMatch: "product.signal.match",
} as const;

export function createLeadMatchingGraph(opts: LeadMatchingGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: LEAD_MATCHING_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const signal_id = signalIdFromState(state);
          return {
            signal_id,
            attributes: mergeAttributes(state, {
              signal_id,
              user_id: String(state.attributes?.user_id ?? ""),
            }),
          };
        },
      }),
    )
    .addNode(
      "match",
      traceLangGraphNode({
        graph_name: LEAD_MATCHING_GRAPH_NAME,
        node_name: "match",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const signal_id = signalIdFromState(state);
          const result = await invokeLangGraphTool<LeadMatchingToolResult>(
            tools.signalMatch,
            { signal_id },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              signal_match_result: result,
            }),
            tool_results: {
              signal_match: result,
            },
          };
        },
      }),
    )
    .addNode(
      "rank",
      traceLangGraphNode({
        graph_name: LEAD_MATCHING_GRAPH_NAME,
        node_name: "rank",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<LeadMatchingToolResult>(state, "signal_match_result");
          const decision = decisionFromMatchResult(result);
          return {
            attributes: mergeAttributes(state, {
              lead_matching: decision,
              ranked_matches: decision.ranked_matches,
              contact_resolution_ready: decision.contact_resolution_ready,
              next_action: decision.next_action,
            }),
            tool_results: {
              lead_matching_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "match")
    .addEdge("match", "rank")
    .addEdge("rank", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runLeadMatchingGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: LeadMatchingGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<LeadMatchingGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("lead matching graph requires a workspace_id");
  }
  const signal_id = normalizeSignalId(opts.input.signal_id);
  const graph = createLeadMatchingGraph({
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
    graph_name: LEAD_MATCHING_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      signal_id,
      thread_id: opts.input.thread_id ?? `signal-match:${workspace_id}:${signal_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: LEAD_MATCHING_GRAPH_NAME,
      attributes: {
        signal_id,
        user_id: opts.input.user_id,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromMatchResult(result: LeadMatchingToolResult): LeadMatchingDecision {
  const ranked_matches = [...result.matches].sort(
    (a, b) => b.match_score - a.match_score,
  );
  const contact_resolution_ready = result.status === "matched" && ranked_matches.length > 0;
  return {
    signal_id: result.signal_id,
    status: result.status,
    ranked_matches,
    match_score: result.match_score,
    match_reason: result.match_reason,
    contact_resolution_ready,
    next_action: nextAction(result, contact_resolution_ready),
  };
}

function nextAction(
  result: LeadMatchingToolResult,
  contactResolutionReady: boolean,
): LeadMatchingDecision["next_action"] {
  if (contactResolutionReady) return "resolve_contacts";
  if (result.skip_reason === "budget") return "wait_for_budget";
  if (result.skip_reason === "no_icps") return "configure_icp";
  if (result.status === "dismissed" || result.skip_reason === "filtered") return "skip";
  return "review_signal";
}

function signalIdFromState(state: BombsellLangGraphState): string {
  return normalizeSignalId(state.signal_id ?? state.attributes?.signal_id);
}

function normalizeSignalId(value: unknown): string {
  const signal_id = typeof value === "string" ? value.trim() : "";
  if (!signal_id) throw new Error("lead matching graph requires signal_id");
  return signal_id;
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
