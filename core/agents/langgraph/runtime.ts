import type { RunnableConfig } from "@langchain/core/runnables";
import type { EventBus } from "../../substrate/events/index.ts";
import type {
  ApprovalDecision,
  ApprovalRequest,
  RunContext,
} from "../../substrate/workflows/types.ts";
import { recordAgentTraceSpan } from "../../observability/index.ts";
import {
  createLangGraphRunnableConfig,
  type LangGraphRunnableConfig,
} from "./checkpoint.ts";
import {
  type BombsellLangGraphState,
  primitiveRefsFromState,
} from "./state.ts";

export interface RunnableLangGraph<S, O> {
  invoke(input: S, config?: RunnableConfig | LangGraphRunnableConfig): Promise<O>;
}

export interface RunLangGraphStepOptions<S extends BombsellLangGraphState, O> {
  graph_name: string;
  graph: RunnableLangGraph<S, O>;
  state: S;
  ctx: RunContext;
  bus?: EventBus;
  step_name?: string;
}

export interface TraceLangGraphNodeOptions<S extends Partial<BombsellLangGraphState>, O> {
  graph_name: string;
  node_name: string;
  bus?: EventBus;
  handler: (state: S) => Promise<O> | O;
}

export async function runLangGraphInWorkflowStep<
  S extends BombsellLangGraphState,
  O,
>(opts: RunLangGraphStepOptions<S, O>): Promise<O> {
  const state = {
    ...opts.state,
    graph_name: opts.graph_name,
    run_id: opts.state.run_id || opts.ctx.run_id,
    correlation_id: opts.state.correlation_id || opts.ctx.correlation_id,
  };
  return opts.ctx.step(opts.step_name ?? `langgraph:${opts.graph_name}`, async () => {
    const started = new Date();
    try {
      const output = await opts.graph.invoke(
        state,
        createLangGraphRunnableConfig(state),
      );
      await recordGraphSpan(opts.bus, state, opts.graph_name, "ok", started);
      return output;
    } catch (error) {
      await recordGraphSpan(opts.bus, state, opts.graph_name, "error", started, error);
      throw error;
    }
  });
}

export function traceLangGraphNode<
  S extends Partial<BombsellLangGraphState>,
  O,
>(opts: TraceLangGraphNodeOptions<S, O>): (state: S) => Promise<O> {
  return async (state: S) => {
    const started = new Date();
    try {
      const output = await opts.handler({
        ...state,
        graph_name: state.graph_name ?? opts.graph_name,
        node_name: opts.node_name,
      });
      await recordNodeSpan(opts.bus, state, opts.graph_name, opts.node_name, "ok", started);
      return output;
    } catch (error) {
      await recordNodeSpan(
        opts.bus,
        state,
        opts.graph_name,
        opts.node_name,
        "error",
        started,
        error,
      );
      throw error;
    }
  };
}

export async function requestLangGraphApproval<P>(
  ctx: RunContext,
  state: BombsellLangGraphState,
  req: ApprovalRequest<P>,
  opts: { bus?: EventBus; node_name?: string } = {},
): Promise<ApprovalDecision> {
  const started = new Date();
  try {
    const decision = await ctx.requestApproval(req);
    await recordAgentTraceSpanIfBus(opts.bus, {
      workspace_id: state.workspace_id,
      kind: "approval.interrupt",
      name: req.kind,
      status: decision.decision === "approved" ? "ok" : "blocked",
      started_at: started,
      ended_at: new Date(),
      graph_name: state.graph_name ?? null,
      node_name: opts.node_name ?? state.node_name ?? null,
      run_id: state.run_id,
      thread_id: state.thread_id,
      correlation_id: state.correlation_id,
      causation_event_id: state.causation_event_id ?? null,
      primitive_refs: primitiveRefsFromState(state),
      attributes: {
        approval_kind: req.kind,
        decision: decision.decision,
      },
    });
    return decision;
  } catch (error) {
    await recordAgentTraceSpanIfBus(opts.bus, {
      workspace_id: state.workspace_id,
      kind: "approval.interrupt",
      name: req.kind,
      status: "error",
      started_at: started,
      ended_at: new Date(),
      graph_name: state.graph_name ?? null,
      node_name: opts.node_name ?? state.node_name ?? null,
      run_id: state.run_id,
      thread_id: state.thread_id,
      correlation_id: state.correlation_id,
      causation_event_id: state.causation_event_id ?? null,
      primitive_refs: primitiveRefsFromState(state),
      attributes: { approval_kind: req.kind },
      error: traceError(error),
    });
    throw error;
  }
}

async function recordGraphSpan(
  bus: EventBus | undefined,
  state: BombsellLangGraphState,
  graph_name: string,
  status: "ok" | "error",
  started_at: Date,
  error?: unknown,
): Promise<void> {
  await recordAgentTraceSpanIfBus(bus, {
    workspace_id: state.workspace_id,
    kind: "agent.run",
    name: graph_name,
    status,
    started_at,
    ended_at: new Date(),
    graph_name,
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: primitiveRefsFromState(state),
    attributes: { runtime: "langgraph", durable_owner: "restate" },
    error: traceError(error),
  });
}

async function recordNodeSpan(
  bus: EventBus | undefined,
  state: Partial<BombsellLangGraphState>,
  graph_name: string,
  node_name: string,
  status: "ok" | "error",
  started_at: Date,
  error?: unknown,
): Promise<void> {
  if (!state.workspace_id || !state.thread_id || !state.run_id || !state.correlation_id) {
    return;
  }
  await recordAgentTraceSpanIfBus(bus, {
    workspace_id: state.workspace_id,
    kind: "langgraph.node",
    name: `${graph_name}:${node_name}`,
    status,
    started_at,
    ended_at: new Date(),
    graph_name,
    node_name,
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: primitiveRefsFromState(state),
    attributes: { runtime: "langgraph" },
    error: traceError(error),
  });
}

async function recordAgentTraceSpanIfBus(
  bus: EventBus | undefined,
  input: Parameters<typeof recordAgentTraceSpan>[1],
): Promise<void> {
  if (!bus) return;
  await recordAgentTraceSpan(bus, input);
}

function traceError(
  error: unknown,
): Error | { message: string; name?: string | null } | null {
  if (!error) return null;
  if (error instanceof Error) return error;
  return { message: String(error) };
}
