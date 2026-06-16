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

export const SIGNAL_INGESTION_GRAPH_NAME = "signal.ingestion_graph.v1";

export interface SignalIngestionGraphInput {
  workspace_id?: string;
  user_id: string;
  limit?: number;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface SignalIngestionToolResult {
  workspace_id: string;
  dispatched: number;
}

export interface SignalIngestionDecision {
  workspace_id: string;
  dispatched: number;
  next_action: "await_signal_ingestion" | "review_sources";
}

export interface SignalIngestionGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    startSourcePolls: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  startSourcePolls: "product.sources.poll.start",
} as const;

export function createSignalIngestionGraph(
  opts: SignalIngestionGraphOptions = {},
) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: SIGNAL_INGESTION_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const input = signalIngestionInputFromState(state);
          return {
            attributes: mergeAttributes(state, {
              user_id: input.user_id,
              limit: normalizedLimit(input.limit),
            }),
          };
        },
      }),
    )
    .addNode(
      "start_polls",
      traceLangGraphNode({
        graph_name: SIGNAL_INGESTION_GRAPH_NAME,
        node_name: "start_polls",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const input = signalIngestionInputFromState(state);
          const result = await invokeLangGraphTool<SignalIngestionToolResult>(
            tools.startSourcePolls,
            { limit: normalizedLimit(input.limit) },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              signal_ingestion_result: result,
            }),
            tool_results: {
              source_polls: result,
            },
          };
        },
      }),
    )
    .addNode(
      "decide",
      traceLangGraphNode({
        graph_name: SIGNAL_INGESTION_GRAPH_NAME,
        node_name: "decide",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const result = getAttribute<SignalIngestionToolResult>(
            state,
            "signal_ingestion_result",
          );
          const decision: SignalIngestionDecision = {
            workspace_id: state.workspace_id,
            dispatched: result.dispatched,
            next_action: result.dispatched > 0
              ? "await_signal_ingestion"
              : "review_sources",
          };
          return {
            attributes: mergeAttributes(state, {
              signal_ingestion: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              signal_ingestion_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "start_polls")
    .addEdge("start_polls", "decide")
    .addEdge("decide", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runSignalIngestionGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: SignalIngestionGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<SignalIngestionGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("signal ingestion graph requires a workspace_id");
  }
  const graph = createSignalIngestionGraph({
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
    graph_name: SIGNAL_INGESTION_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id: opts.input.thread_id ?? `signal-ingestion:${workspace_id}:${opts.ctx.run_id}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: SIGNAL_INGESTION_GRAPH_NAME,
      attributes: {
        user_id: opts.input.user_id,
        limit: normalizedLimit(opts.input.limit),
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function signalIngestionInputFromState(
  state: BombsellLangGraphState,
): SignalIngestionGraphInput {
  return {
    workspace_id: state.workspace_id,
    user_id: String(state.attributes?.user_id ?? ""),
    limit: normalizedLimit(state.attributes?.limit),
    thread_id: state.thread_id,
    run_id: state.run_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
  };
}

function normalizedLimit(value: unknown): number {
  const limit = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return 25;
  return Math.min(100, Math.max(1, Math.trunc(limit)));
}

function getAttribute<T>(state: BombsellLangGraphState, key: string): T {
  return state.attributes?.[key] as T;
}

function mergeAttributes(
  state: Partial<BombsellLangGraphState>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(state.attributes ?? {}), ...patch };
}
