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

export const CHANNEL_READINESS_GRAPH_NAME = "channel.readiness_graph.v1";

type LaunchReadinessStatus = "ready" | "needs_attention" | "blocked";
type LaunchReadinessRequiredChannel = "any" | "email" | "linkedin" | "both";

export interface ChannelReadinessGraphInput {
  workspace_id?: string;
  user_id: string;
  required_channel?: LaunchReadinessRequiredChannel;
  thread_id?: string;
  run_id?: string;
  correlation_id?: string;
  causation_event_id?: string | null;
}

export interface ChannelReadinessCheck {
  id: string;
  label: string;
  primitive: "Rep" | "Signal" | "Play" | "Conversation";
  status: LaunchReadinessStatus;
  required: boolean;
  detail: string;
  count: number;
  action: {
    label: string;
    tools: string[];
    surface: string;
  } | null;
}

export interface ChannelReadinessToolResult {
  workspace_id: string;
  checked_at: string;
  required_channel: LaunchReadinessRequiredChannel;
  status: LaunchReadinessStatus;
  launch_ready: boolean;
  next_action:
    | "start_outreach"
    | "configure_profile"
    | "configure_icp"
    | "configure_rep"
    | "configure_sources"
    | "configure_play"
    | "connect_outlook"
    | "connect_linkedin"
    | "repair_channel";
  checks: ChannelReadinessCheck[];
  blockers: string[];
  warnings: string[];
}

export interface ChannelReadinessDecision {
  workspace_id: string;
  launch_ready: boolean;
  status: LaunchReadinessStatus;
  required_channel: LaunchReadinessRequiredChannel;
  next_action: ChannelReadinessToolResult["next_action"];
  blockers: string[];
  warnings: string[];
  ready_checks: number;
  total_checks: number;
}

export interface ChannelReadinessGraphOptions {
  bus?: EventBus;
  tools?: Partial<{
    launchReadiness: string;
  }>;
  toolOptions?: LangGraphToolOptions;
}

const DEFAULT_TOOLS = {
  launchReadiness: "product.launch.readiness.get",
} as const;

export function createChannelReadinessGraph(opts: ChannelReadinessGraphOptions = {}) {
  const tools = { ...DEFAULT_TOOLS, ...opts.tools };
  const toolOptions = { ...opts.toolOptions, bus: opts.bus };

  return new StateGraph(BombsellGraphStateAnnotation)
    .addNode(
      "request",
      traceLangGraphNode({
        graph_name: CHANNEL_READINESS_GRAPH_NAME,
        node_name: "request",
        bus: opts.bus,
        handler: (state: BombsellLangGraphState) => {
          const required_channel = requiredChannelFromState(state);
          return {
            attributes: mergeAttributes(state, {
              required_channel,
              user_id: String(state.attributes?.user_id ?? ""),
            }),
          };
        },
      }),
    )
    .addNode(
      "check",
      traceLangGraphNode({
        graph_name: CHANNEL_READINESS_GRAPH_NAME,
        node_name: "check",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const required_channel = requiredChannelFromState(state);
          const result = await invokeLangGraphTool<ChannelReadinessToolResult>(
            tools.launchReadiness,
            { required_channel },
            state,
            toolOptions,
          );
          return {
            attributes: mergeAttributes(state, {
              launch_readiness_result: result,
            }),
            tool_results: {
              launch_readiness: result,
            },
          };
        },
      }),
    )
    .addNode(
      "summarize",
      traceLangGraphNode({
        graph_name: CHANNEL_READINESS_GRAPH_NAME,
        node_name: "summarize",
        bus: opts.bus,
        handler: async (state: BombsellLangGraphState) => {
          const result = getAttribute<ChannelReadinessToolResult>(
            state,
            "launch_readiness_result",
          );
          const decision = decisionFromReadiness(result);
          await opts.bus?.publish({
            workspace_id: result.workspace_id,
            event_type: "workspace.launch.readiness.checked",
            source: "system",
            producer_ref: CHANNEL_READINESS_GRAPH_NAME,
            correlation_id: state.correlation_id,
            causation_id: state.causation_event_id ?? undefined,
            payload: {
              checked_at: result.checked_at,
              required_channel: result.required_channel,
              status: result.status,
              launch_ready: result.launch_ready,
              next_action: result.next_action,
              checks: result.checks,
              blockers: result.blockers,
              warnings: result.warnings,
            },
          });
          return {
            attributes: mergeAttributes(state, {
              launch_readiness: decision,
              next_action: decision.next_action,
            }),
            tool_results: {
              launch_readiness_decision: decision,
            },
          };
        },
      }),
    )
    .addEdge(START, "request")
    .addEdge("request", "check")
    .addEdge("check", "summarize")
    .addEdge("summarize", END)
    .compile({ checkpointer: createLangGraphMemoryCheckpoint() });
}

export async function runChannelReadinessGraphInWorkflowStep(opts: {
  ctx: RunContext;
  input: ChannelReadinessGraphInput;
  bus?: EventBus;
  graphOptions?: Omit<ChannelReadinessGraphOptions, "bus" | "toolOptions"> & {
    toolOptions?: Omit<LangGraphToolOptions, "bus">;
  };
}): Promise<BombsellLangGraphState> {
  const workspace_id = opts.input.workspace_id ?? opts.ctx.workspace_id;
  if (!workspace_id) {
    throw new Error("channel readiness graph requires a workspace_id");
  }
  const required_channel = normalizeRequiredChannel(opts.input.required_channel);
  const graph = createChannelReadinessGraph({
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
    graph_name: CHANNEL_READINESS_GRAPH_NAME,
    graph,
    ctx: opts.ctx,
    bus: opts.bus,
    state: {
      workspace_id,
      thread_id:
        opts.input.thread_id ??
        `channel-readiness:${workspace_id}:${required_channel}`,
      run_id: opts.input.run_id ?? opts.ctx.run_id,
      correlation_id: opts.input.correlation_id ?? opts.ctx.correlation_id,
      causation_event_id: opts.input.causation_event_id ?? null,
      graph_name: CHANNEL_READINESS_GRAPH_NAME,
      attributes: {
        required_channel,
        user_id: opts.input.user_id,
      },
      tool_results: {},
      approvals: {},
    },
  });
}

function decisionFromReadiness(
  result: ChannelReadinessToolResult,
): ChannelReadinessDecision {
  return {
    workspace_id: result.workspace_id,
    launch_ready: result.launch_ready,
    status: result.status,
    required_channel: result.required_channel,
    next_action: result.next_action,
    blockers: result.blockers,
    warnings: result.warnings,
    ready_checks: result.checks.filter((check) => check.status === "ready").length,
    total_checks: result.checks.length,
  };
}

function requiredChannelFromState(
  state: BombsellLangGraphState,
): LaunchReadinessRequiredChannel {
  return normalizeRequiredChannel(state.attributes?.required_channel);
}

function normalizeRequiredChannel(value: unknown): LaunchReadinessRequiredChannel {
  return value === "email" || value === "linkedin" || value === "both" ? value : "any";
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
