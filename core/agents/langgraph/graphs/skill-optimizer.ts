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

export const SKILL_OPTIMIZER_GRAPH_NAME = "skill.optimizer_graph.v1";

export interface SkillOptimizerGraphInput {
  workspace_id?: string;
  user_id: string;
  lookback_days?: number;
  min_samples?: number;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface SkillOptimizationRecommendation {
  skill_key: string;
  pattern_key: string;
  channel: string | null;
  segment_key: string;
  rep_id: string | null;
  rep_name: string | null;
  sample_count: number;
  outcome_count: number;
  reply_outcomes: number;
  positive_outcomes: number;
  negative_outcomes: number;
  meeting_outcomes: number;
  reply_rate: number;
  positive_outcome_rate: number;
  meeting_rate: number;
  negative_outcome_rate: number;
  memory_win_count: number;
  memory_loss_count: number;
  memory_delta_score: number;
  utility_score: number;
  confidence: number;
  allocation_weight: number;
  recommendation: "double_down" | "hold" | "reduce" | "not_enough_proof";
  next_action: "apply_play_gate" | "review_reduce" | "keep_learning" | "no_change";
  explanation: string;
  source_variant_keys: string[];
}

export interface SkillOptimizerToolResult {
  workspace_id: string;
  recommendation_id: string;
  generated_at: string;
  min_samples: number;
  summary: string;
  recommendations: SkillOptimizationRecommendation[];
}

export interface SkillOptimizerDecision {
  recommendation_id: string;
  summary: string;
  top_recommendation: SkillOptimizationRecommendation | null;
  double_down_count: number;
  reduce_count: number;
  exploring_count: number;
  next_action: "apply_play_gate" | "review_reduce" | "keep_learning" | "no_change";
}

export interface SkillOptimizerGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    optimizePlaySkills: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  optimizePlaySkills: "product.play.skills.optimize",
} as const;

export function createSkillOptimizerGraph(opts: SkillOptimizerGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: SKILL_OPTIMIZER_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => ({
          attributes: mergeAttributes(state, {
            user_id: String(state.attributes?.user_id ?? ""),
            lookback_days: numericAttribute(state, "lookback_days"),
            min_samples: numericAttribute(state, "min_samples"),
          }),
        }),
      }),
    )
    .addNode(
      "optimize",
      traceLangGraphNode({
        graph_name: SKILL_OPTIMIZER_GRAPH_NAME,
        node_name: "optimize",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const result = await invokeLangGraphTool<SkillOptimizerToolResult>(
            tools.optimizePlaySkills,
            {
              lookback_days: numericAttribute(state, "lookback_days"),
              min_samples: numericAttribute(state, "min_samples"),
            },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              skill_optimizer_result: result,
            }),
            tool_results: {
              skill_optimizer: result,
            },
          };
        },
      }),
    )
    .addNode(
      "recommend",
      traceLangGraphNode({
        graph_name: SKILL_OPTIMIZER_GRAPH_NAME,
        node_name: "recommend",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<SkillOptimizerToolResult>(
            state,
            "skill_optimizer_result",
          );
          const decision = decisionFromOptimization(result);
          return {
            attributes: mergeAttributes(state, {
              skill_optimizer: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              skill_optimizer_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "optimize")
    .addEdge("optimize", "recommend")
    .addEdge("recommend", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runSkillOptimizerGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: SkillOptimizerGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<SkillOptimizerGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("skill optimizer graph requires a workspace_id");
  }
  const graph = createSkillOptimizerGraph({
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
    graph_name: SKILL_OPTIMIZER_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ?? `skill-optimizer:${workspace_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: SKILL_OPTIMIZER_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        lookback_days: opts.input.lookback_days,
        min_samples: opts.input.min_samples,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromOptimization(
  result: SkillOptimizerToolResult,
): SkillOptimizerDecision {
  const top_recommendation =
    result.recommendations.find((item) => item.recommendation === "double_down") ??
    result.recommendations.find((item) => item.recommendation === "reduce") ??
    result.recommendations[0] ??
    null;
  const double_down_count = result.recommendations.filter((item) =>
    item.recommendation === "double_down"
  ).length;
  const reduce_count = result.recommendations.filter((item) =>
    item.recommendation === "reduce"
  ).length;
  const exploring_count = result.recommendations.filter((item) =>
    item.recommendation === "not_enough_proof"
  ).length;
  return {
    recommendation_id: result.recommendation_id,
    summary: result.summary,
    top_recommendation,
    double_down_count,
    reduce_count,
    exploring_count,
    next_action: nextAction(result.recommendations),
  };
}

function nextAction(
  recommendations: SkillOptimizationRecommendation[],
): SkillOptimizerDecision["next_action"] {
  if (recommendations.some((item) => item.next_action === "apply_play_gate")) {
    return "apply_play_gate";
  }
  if (recommendations.some((item) => item.next_action === "review_reduce")) {
    return "review_reduce";
  }
  if (recommendations.some((item) => item.next_action === "keep_learning")) {
    return "keep_learning";
  }
  return "no_change";
}

function numericAttribute(
  state: BombsellLangGraphState,
  key: string,
): number | undefined {
  const value = state.attributes?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
