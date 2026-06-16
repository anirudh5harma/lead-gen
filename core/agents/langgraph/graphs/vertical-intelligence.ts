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

export const VERTICAL_INTELLIGENCE_GRAPH_NAME = "vertical.intelligence_graph.v1";

export type VerticalIntelligenceFactCategory =
  | "icp_rule"
  | "pain"
  | "objection"
  | "proof"
  | "competitor"
  | "trigger"
  | "positioning"
  | "signal_mapping"
  | "skill_performance";

export interface VerticalIntelligenceGraphInput {
  workspace_id?: string;
  user_id: string;
  company_id?: string | null;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface VerticalIntelligenceSourceRef {
  type: string;
  id: string;
  label: string;
  url?: string | null;
}

export interface VerticalIntelligencePrimitiveRefs {
  rep_id?: string | null;
  signal_id?: string | null;
  play_id?: string | null;
  play_run_id?: string | null;
  outcome_id?: string | null;
  company_id?: string | null;
  person_id?: string | null;
  icp_id?: string | null;
}

export interface VerticalIntelligenceFact {
  id: string;
  category: VerticalIntelligenceFactCategory;
  statement: string;
  confidence: number;
  tags: string[];
  source_refs: VerticalIntelligenceSourceRef[];
  primitive_refs: VerticalIntelligencePrimitiveRefs;
  last_observed_at: string;
  included_in_prompt: boolean;
}

export interface VerticalIntelligenceToolResult {
  workspace_id: string;
  company_id: string;
  company_name: string;
  vertical: string;
  generated_at: string;
  graph_name: string;
  run_id: string;
  confidence: number;
  facts: VerticalIntelligenceFact[];
  prompt_context: string;
  evidence_source_ids: string[];
  redaction_status: "source_refs_only";
}

export interface VerticalIntelligenceDecision {
  workspace_id: string;
  company_id: string;
  company_name: string;
  vertical: string;
  fact_count: number;
  prompt_fact_count: number;
  source_ref_count: number;
  evidence_source_count: number;
  confidence: number;
  redaction_status: "source_refs_only";
  next_action: "use_vertical_context" | "enrich_profile" | "configure_icp";
}

export interface VerticalIntelligenceGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    refreshVerticalIntelligence: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  refreshVerticalIntelligence: "product.vertical_intelligence.refresh",
} as const;

export function createVerticalIntelligenceGraph(
  opts: VerticalIntelligenceGraphOptions = {},
) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: VERTICAL_INTELLIGENCE_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const company_id = companyIdFromState(state);
          return {
            company_id,
            attributes: mergeAttributes(state, {
              company_id,
              user_id: String(state.attributes?.user_id ?? ""),
            }),
          };
        },
      }),
    )
    .addNode(
      "refresh",
      traceLangGraphNode({
        graph_name: VERTICAL_INTELLIGENCE_GRAPH_NAME,
        node_name: "refresh",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const company_id = companyIdFromState(state);
          const started = new Date();
          const result = await invokeLangGraphTool<VerticalIntelligenceToolResult>(
            tools.refreshVerticalIntelligence,
            company_id ? { company_id } : {},
            state,
            toolOptions,
          );
          await recordVerticalMemorySpan(opts.bus, state, started, result);
          return {
            company_id: result.company_id,
            attributes: mergeAttributes(state, {
              company_id: result.company_id,
              vertical_intelligence_result: result,
            }),
            tool_results: {
              vertical_intelligence: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: VERTICAL_INTELLIGENCE_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<VerticalIntelligenceToolResult>(
            state,
            "vertical_intelligence_result",
          );
          const decision = decisionFromPack(result);
          return {
            attributes: mergeAttributes(state, {
              vertical_intelligence: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              vertical_intelligence_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "refresh")
    .addEdge("refresh", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runVerticalIntelligenceGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: VerticalIntelligenceGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<VerticalIntelligenceGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("vertical intelligence graph requires a workspace_id");
  }
  const graph = createVerticalIntelligenceGraph({
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
  const company_id = opts.input.company_id ?? null;
  return runLangGraphInWorkflowStep({
    graph_name: VERTICAL_INTELLIGENCE_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      company_id,
      thread_id: opts.input.thread_id ??
        `vertical-intelligence:${workspace_id}:${company_id ?? "workspace"}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: VERTICAL_INTELLIGENCE_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        company_id,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromPack(
  result: VerticalIntelligenceToolResult,
): VerticalIntelligenceDecision {
  const prompt_fact_count = result.facts.filter((fact) => fact.included_in_prompt).length;
  const source_ref_count = result.facts.reduce(
    (sum, fact) => sum + fact.source_refs.length,
    0,
  );
  return {
    workspace_id: result.workspace_id,
    company_id: result.company_id,
    company_name: result.company_name,
    vertical: result.vertical,
    fact_count: result.facts.length,
    prompt_fact_count,
    source_ref_count,
    evidence_source_count: result.evidence_source_ids.length,
    confidence: result.confidence,
    redaction_status: result.redaction_status,
    next_action: nextAction(result, prompt_fact_count),
  };
}

function nextAction(
  result: VerticalIntelligenceToolResult,
  prompt_fact_count: number,
): VerticalIntelligenceDecision["next_action"] {
  if (prompt_fact_count > 0) return "use_vertical_context";
  if (result.evidence_source_ids.length === 0) return "enrich_profile";
  return "configure_icp";
}

async function recordVerticalMemorySpan(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  started_at: Date,
  result: VerticalIntelligenceToolResult,
): Promise<void> {
  if (!bus) return;
  await recordAgentTraceSpan(bus, {
    workspace_id: state.workspace_id,
    kind: "memory.write",
    name: "vertical.intelligence.refresh",
    status: "ok",
    started_at,
    ended_at: new Date(),
    graph_name: state.graph_name ?? null,
    node_name: state.node_name ?? null,
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: {
      ...primitiveRefsFromState(state),
      company_id: result.company_id,
    },
    attributes: {
      runtime: "langgraph",
      memory_layer: "vertical_intelligence",
      vertical: result.vertical,
      fact_count: result.facts.length,
      prompt_fact_count: result.facts.filter((fact) => fact.included_in_prompt).length,
      evidence_source_count: result.evidence_source_ids.length,
      confidence: result.confidence,
    },
  });
}

function companyIdFromState(state: BombsellLangGraphState): string | null {
  const value = state.company_id ?? state.attributes?.company_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
