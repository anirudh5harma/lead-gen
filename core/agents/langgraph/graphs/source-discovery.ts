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

export const SOURCE_DISCOVERY_GRAPH_NAME = "source.discovery_graph.v1";

export type SourceDiscoverySignalKind =
  | "funding"
  | "hiring"
  | "leadership_change"
  | "product_launch"
  | "acquisition"
  | "churn_risk"
  | "competitor_move"
  | "podcast_mention"
  | "press_mention"
  | "regulation"
  | "expansion"
  | "layoff"
  | "other";

export interface SourceDiscoveryGraphInput {
  workspace_id?: string;
  user_id: string;
  company_name: string;
  website_url?: string | null;
  industry?: string | null;
  description?: string | null;
  signal_kind?: SourceDiscoverySignalKind;
  open_web_query?: string | null;
  enable_open_web?: boolean;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface DefaultAggregatorResult {
  workspace_id: string;
  source_count: number;
}

export interface OpenWebSourceResult {
  workspace_id: string;
  source_id: string;
}

export interface SourceDiscoveryDecision {
  workspace_id: string;
  company_name: string;
  default_source_count: number;
  open_web_source_id: string | null;
  configured_source_count: number;
  next_action: "run_aggregator" | "review_sources";
}

export interface SourceDiscoveryGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    configureDefaultAggregator: string;
    configureOpenWebSource: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  configureDefaultAggregator: "product.sources.default_aggregator.configure",
  configureOpenWebSource: "product.signal.discover_open_web",
} as const;

export function createSourceDiscoveryGraph(opts: SourceDiscoveryGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: SOURCE_DISCOVERY_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = sourceDiscoveryInputFromState(state);
          return {
            attributes: mergeAttributes(state, {
              user_id: input.user_id,
              company_name: input.company_name,
              website_url: input.website_url ?? null,
              industry: input.industry ?? null,
              description: input.description ?? null,
              signal_kind: input.signal_kind ?? "other",
              open_web_query: normalizedOpenWebQuery(input),
              enable_open_web: input.enable_open_web === true,
            }),
          };
        },
      }),
    )
    .addNode(
      "default_sources",
      traceLangGraphNode({
        graph_name: SOURCE_DISCOVERY_GRAPH_NAME,
        node_name: "default_sources",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = sourceDiscoveryInputFromState(state);
          const result = await invokeLangGraphTool<DefaultAggregatorResult>(
            tools.configureDefaultAggregator,
            {
              company_name: input.company_name,
              website_url: input.website_url ?? undefined,
              industry: input.industry ?? undefined,
              description: input.description ?? undefined,
              signal_kind: input.signal_kind ?? "other",
            },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              default_aggregator_result: result,
            }),
            tool_results: {
              default_aggregator: result,
            },
          };
        },
      }),
    )
    .addNode(
      "open_web",
      traceLangGraphNode({
        graph_name: SOURCE_DISCOVERY_GRAPH_NAME,
        node_name: "open_web",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = sourceDiscoveryInputFromState(state);
          const query = normalizedOpenWebQuery(input);
          if (input.enable_open_web !== true || !query) {
            return {
              attributes: mergeAttributes(state, {
                open_web_source_result: null,
              }),
            };
          }
          const result = await invokeLangGraphTool<OpenWebSourceResult>(
            tools.configureOpenWebSource,
            {
              query,
              source_name: `${input.company_name} open-web signals`,
              signal_kind: input.signal_kind ?? "other",
              limit: 25,
              max_daily_items: 25,
              max_daily_calls: 6,
              enabled: true,
            },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              open_web_source_result: result,
            }),
            tool_results: {
              open_web_source: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: SOURCE_DISCOVERY_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const defaults = getAttribute<DefaultAggregatorResult>(
            state,
            "default_aggregator_result",
          );
          const openWeb = nullableAttribute<OpenWebSourceResult>(
            state,
            "open_web_source_result",
          );
          const input = sourceDiscoveryInputFromState(state);
          const decision = decisionFromSources(input, defaults, openWeb);
          return {
            attributes: mergeAttributes(state, {
              source_discovery: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              source_discovery_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "default_sources")
    .addEdge("default_sources", "open_web")
    .addEdge("open_web", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runSourceDiscoveryGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: SourceDiscoveryGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<SourceDiscoveryGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("source discovery graph requires a workspace_id");
  }
  const graph = createSourceDiscoveryGraph({
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
  const companyName = normalizeCompanyName(opts.input.company_name);
  return runLangGraphInWorkflowStep({
    graph_name: SOURCE_DISCOVERY_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ?? `source-discovery:${workspace_id}:${companyName}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: SOURCE_DISCOVERY_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        company_name: companyName,
        website_url: opts.input.website_url ?? null,
        industry: opts.input.industry ?? null,
        description: opts.input.description ?? null,
        signal_kind: opts.input.signal_kind ?? "other",
        open_web_query: opts.input.open_web_query ?? null,
        enable_open_web: opts.input.enable_open_web === true,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromSources(
  input: SourceDiscoveryGraphInput,
  defaults: DefaultAggregatorResult,
  openWeb: OpenWebSourceResult | null,
): SourceDiscoveryDecision {
  const configured_source_count = defaults.source_count + (openWeb ? 1 : 0);
  return {
    workspace_id: defaults.workspace_id,
    company_name: input.company_name,
    default_source_count: defaults.source_count,
    open_web_source_id: openWeb?.source_id ?? null,
    configured_source_count,
    next_action: configured_source_count > 0 ? "run_aggregator" : "review_sources",
  };
}

function sourceDiscoveryInputFromState(
  state: BombsellLangGraphState,
): SourceDiscoveryGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: requiredString(state.attributes?.user_id, "user_id"),
    company_name: normalizeCompanyName(state.attributes?.company_name),
    website_url: optionalString(state.attributes?.website_url),
    industry: optionalString(state.attributes?.industry),
    description: optionalString(state.attributes?.description),
    signal_kind: signalKindOrUndefined(state.attributes?.signal_kind),
    open_web_query: optionalString(state.attributes?.open_web_query),
    enable_open_web: state.attributes?.enable_open_web === true,
    thread_id: state.thread_id,
    run_id: state.run_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
  };
}

function normalizedOpenWebQuery(input: SourceDiscoveryGraphInput): string | null {
  if (input.open_web_query?.trim()) return input.open_web_query.trim();
  if (input.enable_open_web !== true) return null;
  const parts = [
    input.company_name,
    input.industry ?? null,
    input.description ?? null,
    "funding hiring product launch customer expansion",
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.join(" ").replace(/\s+/g, " ").trim() || null;
}

function getAttribute<T>(state: BombsellLangGraphState, key: string): T {
  const value = state.attributes?.[key];
  if (value == null) throw new Error(`missing graph attribute: ${key}`);
  return value as T;
}

function nullableAttribute<T>(state: BombsellLangGraphState, key: string): T | null {
  const value = state.attributes?.[key];
  return value == null ? null : value as T;
}

function mergeAttributes(
  state: BombsellLangGraphState,
  next: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(state.attributes ?? {}), ...next };
}

function normalizeCompanyName(value: unknown): string {
  const normalized = requiredString(value, "company_name");
  return normalized.replace(/\s+/g, " ");
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`source discovery graph requires ${field}`);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function signalKindOrUndefined(value: unknown): SourceDiscoverySignalKind | undefined {
  return typeof value === "string" && [
    "funding",
    "hiring",
    "leadership_change",
    "product_launch",
    "acquisition",
    "churn_risk",
    "competitor_move",
    "podcast_mention",
    "press_mention",
    "regulation",
    "expansion",
    "layoff",
    "other",
  ].includes(value) ? value as SourceDiscoverySignalKind : undefined;
}
