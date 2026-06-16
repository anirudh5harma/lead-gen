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

export const CAMPAIGN_STRATEGY_GRAPH_NAME = "campaign.strategy_graph.v1";

export interface CampaignStrategyGraphInput {
  workspace_id?: string;
  user_id: string;
  lookback_days?: number;
  min_samples?: number;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface CampaignStrategyVariant {
  variant_key: string;
  play_id: string;
  play_name: string;
  rep_id: string | null;
  rep_name: string | null;
  channel: string | null;
  skill_key: string;
  pattern_key: string;
  segment_key: string;
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
  utility_score: number;
  confidence: number;
  allocation_weight: number;
  recommendation: "double_down" | "hold" | "reduce" | "not_enough_proof";
  explanation: string;
}

export interface CampaignStrategyToolResult {
  workspace_id: string;
  recommendation_id: string;
  generated_at: string;
  min_samples: number;
  summary: string;
  variants: CampaignStrategyVariant[];
}

export interface CampaignStrategyDecision {
  recommendation_id: string;
  summary: string;
  top_variant: CampaignStrategyVariant | null;
  reduce_count: number;
  exploring_count: number;
  next_action: "double_down" | "reduce_risky" | "keep_exploring" | "hold";
}

export interface CampaignStrategyGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    optimizeCampaignStrategy: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  optimizeCampaignStrategy: "product.campaign.strategy.optimize",
} as const;

export function createCampaignStrategyGraph(opts: CampaignStrategyGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: CAMPAIGN_STRATEGY_GRAPH_NAME,
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
        graph_name: CAMPAIGN_STRATEGY_GRAPH_NAME,
        node_name: "optimize",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const result = await invokeLangGraphTool<CampaignStrategyToolResult>(
            tools.optimizeCampaignStrategy,
            {
              lookback_days: numericAttribute(state, "lookback_days"),
              min_samples: numericAttribute(state, "min_samples"),
            },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              campaign_strategy_result: result,
            }),
            tool_results: {
              campaign_strategy: result,
            },
          };
        },
      }),
    )
    .addNode(
      "recommend",
      traceLangGraphNode({
        graph_name: CAMPAIGN_STRATEGY_GRAPH_NAME,
        node_name: "recommend",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<CampaignStrategyToolResult>(
            state,
            "campaign_strategy_result",
          );
          const decision = decisionFromStrategy(result);
          return {
            attributes: mergeAttributes(state, {
              campaign_strategy: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              campaign_strategy_decision: decision,
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

export async function runCampaignStrategyGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: CampaignStrategyGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<CampaignStrategyGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("campaign strategy graph requires a workspace_id");
  }
  const graph = createCampaignStrategyGraph({
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
    graph_name: CAMPAIGN_STRATEGY_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ?? `campaign-strategy:${workspace_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: CAMPAIGN_STRATEGY_GRAPH_NAME,
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

function decisionFromStrategy(
  result: CampaignStrategyToolResult,
): CampaignStrategyDecision {
  const top_variant =
    result.variants.find((variant) => variant.recommendation === "double_down") ??
    result.variants.find((variant) => variant.recommendation === "reduce") ??
    result.variants[0] ??
    null;
  const reduce_count = result.variants.filter((variant) => variant.recommendation === "reduce").length;
  const exploring_count = result.variants.filter((variant) =>
    variant.recommendation === "not_enough_proof"
  ).length;
  return {
    recommendation_id: result.recommendation_id,
    summary: result.summary,
    top_variant,
    reduce_count,
    exploring_count,
    next_action: nextAction(top_variant),
  };
}

function nextAction(
  topVariant: CampaignStrategyVariant | null,
): CampaignStrategyDecision["next_action"] {
  if (!topVariant) return "keep_exploring";
  if (topVariant.recommendation === "double_down") return "double_down";
  if (topVariant.recommendation === "reduce") return "reduce_risky";
  if (topVariant.recommendation === "not_enough_proof") return "keep_exploring";
  return "hold";
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
