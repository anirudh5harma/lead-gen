import { END, START, StateGraph } from "@langchain/langgraph";
import type { EventBus } from "../../../substrate/events/index.ts";
import type { RunContext } from "../../../substrate/workflows/index.ts";
import { recordAgentTraceSpan } from "../../../observability/index.ts";
import {
  createLangGraphMemoryCheckpoint,
} from "../checkpoint.ts";
import {
  type BombsellLangGraphState,
  BombsellGraphStateAnnotation,
  primitiveRefsFromState,
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
export const LEAD_MATCHING_MIN_MATCH_SCORE = 0.6;

type SignalMatchStatus = "matched" | "dismissed" | "skipped";
type SignalMatchSkipReason = "no_icps" | "budget" | "not_found" | "non_json" | "filtered";
type LeadMatchingDeferReason =
  | SignalMatchSkipReason
  | "empty_candidates"
  | "below_eval_threshold"
  | "inconsistent_match_result";

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

export interface LeadMatchingHybridShortlistCandidate {
  icp_segment: string;
  scores: {
    vec_sim: number;
    graph_prox: number;
    intent_prior: number;
    hybrid_score: number;
    passed_must_haves: boolean;
  };
}

export interface LeadMatchingHybridShortlist {
  workspace_id: string;
  signal_id: string;
  candidates: LeadMatchingHybridShortlistCandidate[];
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
  defer_reason: LeadMatchingDeferReason | null;
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
  hybridShortlistProvider?: (input: {
    workspace_id: string;
    signal_id: string;
  }) => Promise<LeadMatchingHybridShortlist | null>;
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
        handler: async (state: BombsellLangGraphState) => {
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
      "shortlist",
      traceLangGraphNode({
        graph_name: LEAD_MATCHING_GRAPH_NAME,
        node_name: "shortlist",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const signal_id = signalIdFromState(state);
          const workspace_id = state.workspace_id;
          if (!workspace_id) {
            throw new Error("lead matching graph requires workspace_id before shortlist");
          }
          const shortlist = opts.hybridShortlistProvider
            ? await opts.hybridShortlistProvider({ workspace_id, signal_id })
            : null;
          return {
            attributes: mergeAttributes(state, {
              lead_matching_shortlist: shortlist,
            }),
            tool_results: shortlist
              ? {
                  lead_matching_shortlist: shortlist,
                }
              : {},
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
          // TODO(architecture): core/product/app.ts currently exposes
          // `product.signal.match` with input { signal_id } only. Once that
          // internal tool boundary is widened, pass the graph-computed hybrid
          // shortlist through here instead of recomputing it inside classifySignal.
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
        handler: async (state: BombsellLangGraphState) => {
          const result = getAttribute<LeadMatchingToolResult>(state, "signal_match_result");
          const decision = decisionFromMatchResult(result);
          await recordLeadMatchingDefer(opts.bus, state, decision);
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
    .addEdge("request", "shortlist")
    .addEdge("shortlist", "match")
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
  const ranked_matches = rankMatches(result.matches);
  const defer_reason = deferReason(result, ranked_matches);
  const contact_resolution_ready = defer_reason == null && result.status === "matched";
  const top = ranked_matches[0] ?? null;
  return {
    signal_id: result.signal_id,
    status: contact_resolution_ready ? "matched" : result.status === "dismissed" ? "dismissed" : "skipped",
    ranked_matches,
    match_score: top?.match_score ?? result.match_score,
    match_reason: top?.reason ?? result.match_reason,
    contact_resolution_ready,
    defer_reason,
    next_action: nextAction(result, contact_resolution_ready, defer_reason),
  };
}

function nextAction(
  result: LeadMatchingToolResult,
  contactResolutionReady: boolean,
  deferReason: LeadMatchingDeferReason | null,
): LeadMatchingDecision["next_action"] {
  if (contactResolutionReady) return "resolve_contacts";
  if (deferReason === "budget") return "wait_for_budget";
  if (deferReason === "no_icps") return "configure_icp";
  if (result.status === "dismissed" || result.skip_reason === "filtered") return "skip";
  return "review_signal";
}

function rankMatches(matches: LeadMatchingMatch[]): LeadMatchingMatch[] {
  const bestByIcp = new Map<string, LeadMatchingMatch>();
  for (const match of matches) {
    if (!match.icp_segment.trim()) continue;
    if (!Number.isFinite(match.match_score)) continue;
    if (match.match_score < 0 || match.match_score > 1) continue;
    const normalized: LeadMatchingMatch = {
      icp_segment: match.icp_segment,
      match_score: match.match_score,
      reason: match.reason,
    };
    const existing = bestByIcp.get(normalized.icp_segment);
    if (!existing || compareMatches(normalized, existing) < 0) {
      bestByIcp.set(normalized.icp_segment, normalized);
    }
  }
  return [...bestByIcp.values()].sort(compareMatches);
}

function compareMatches(a: LeadMatchingMatch, b: LeadMatchingMatch): number {
  return b.match_score - a.match_score ||
    a.icp_segment.localeCompare(b.icp_segment) ||
    a.reason.localeCompare(b.reason);
}

function deferReason(
  result: LeadMatchingToolResult,
  rankedMatches: LeadMatchingMatch[],
): LeadMatchingDeferReason | null {
  if (result.status !== "matched") return result.skip_reason ?? null;
  if (rankedMatches.length === 0) return "empty_candidates";
  const top = rankedMatches[0];
  if (!top) return "empty_candidates";
  if (!result.matched_icp_ids.includes(top.icp_segment)) {
    return "inconsistent_match_result";
  }
  if (top.match_score < LEAD_MATCHING_MIN_MATCH_SCORE) {
    return "below_eval_threshold";
  }
  return null;
}

async function recordLeadMatchingDefer(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  decision: LeadMatchingDecision,
): Promise<void> {
  if (!bus || !decision.defer_reason) return;
  await bus.publish({
    workspace_id: state.workspace_id,
    event_type: "signal.matching.deferred",
    source: "agent",
    producer_ref: `langgraph:${LEAD_MATCHING_GRAPH_NAME}`,
    correlation_id: state.correlation_id,
    causation_id: state.causation_event_id ?? undefined,
    idempotency_key:
      `${LEAD_MATCHING_GRAPH_NAME}:deferred:${state.run_id}:${decision.signal_id}:${decision.defer_reason}`,
    payload: {
      workspace_id: state.workspace_id,
      signal_id: decision.signal_id,
      defer_reason: decision.defer_reason,
    },
  });
  await recordAgentTraceSpan(bus, {
    workspace_id: state.workspace_id,
    kind: "langgraph.node",
    name: `${LEAD_MATCHING_GRAPH_NAME}:rank.deferred`,
    status: "deferred",
    graph_name: LEAD_MATCHING_GRAPH_NAME,
    node_name: "rank",
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: primitiveRefsFromState(state),
    attributes: {
      signal_id: decision.signal_id,
      defer_reason: decision.defer_reason,
      match_score: decision.match_score,
      ranked_match_count: decision.ranked_matches.length,
      next_action: decision.next_action,
    },
    producer_ref: `langgraph:${LEAD_MATCHING_GRAPH_NAME}`,
  });
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
