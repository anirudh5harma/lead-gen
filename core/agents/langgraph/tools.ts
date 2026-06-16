import { DynamicStructuredTool } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { recordAgentTraceSpan } from "../../observability/index.ts";
import type { EventBus } from "../../substrate/events/index.ts";
import {
  getTool,
  invokeTool,
  listTools,
} from "../tools/registry.ts";
import type { ToolContext } from "../tools/types.ts";
import {
  type BombsellLangGraphState,
  primitiveRefsFromState,
} from "./state.ts";

export interface LangGraphToolRuntime {
  state?: Partial<BombsellLangGraphState>;
}

export interface LangGraphToolOptions {
  defaultContext?: Partial<ToolContext>;
  bus?: EventBus;
}

export function invokeLangGraphTool<T = unknown>(
  name: string,
  input: unknown,
  state: Partial<BombsellLangGraphState>,
  opts: LangGraphToolOptions = {},
): Promise<T> {
  return invokeLangGraphToolWithTrace(name, input, state, opts);
}

export function createLangGraphTool(
  name: string,
  opts: LangGraphToolOptions = {},
): DynamicStructuredTool {
  const def = getTool(name);
  if (!def) throw new Error(`Unknown tool: ${name}`);
  return new DynamicStructuredTool({
    name: def.name,
    description: def.description,
    schema: def.input,
    func: async (input, _runManager, config) => {
      const runtime = config as
        | (LangGraphToolRuntime & {
            configurable?: { state?: Partial<BombsellLangGraphState> };
          })
        | undefined;
      const state = runtime?.state ?? runtime?.configurable?.state ?? {};
      const output = await invokeLangGraphTool(def.name, input, state, opts);
      return typeof output === "string" ? output : JSON.stringify(output);
    },
  });
}

async function invokeLangGraphToolWithTrace<T>(
  name: string,
  input: unknown,
  state: Partial<BombsellLangGraphState>,
  opts: LangGraphToolOptions,
): Promise<T> {
  const def = getTool(name);
  const ctx = toolContextFromState(state, opts.defaultContext);
  const started = new Date();
  try {
    const output = await invokeTool<T>(name, input, ctx);
    await recordToolSpan(opts.bus, state, name, def?.kind ?? "read", "ok", started);
    return output;
  } catch (error) {
    await recordToolSpan(opts.bus, state, name, def?.kind ?? "read", "error", started, error);
    throw error;
  }
}

async function recordToolSpan(
  bus: EventBus | undefined,
  state: Partial<BombsellLangGraphState>,
  tool_name: string,
  tool_kind: string,
  status: "ok" | "error",
  started_at: Date,
  error?: unknown,
): Promise<void> {
  if (!bus || !state.workspace_id || !state.thread_id || !state.run_id || !state.correlation_id) {
    return;
  }
  await recordAgentTraceSpan(bus, {
    workspace_id: state.workspace_id,
    kind: "tool.call",
    name: tool_name,
    status,
    started_at,
    ended_at: new Date(),
    graph_name: state.graph_name ?? null,
    node_name: state.node_name ?? null,
    run_id: state.run_id,
    thread_id: state.thread_id,
    correlation_id: state.correlation_id,
    causation_event_id: state.causation_event_id ?? null,
    primitive_refs: primitiveRefsFromState(state),
    attributes: {
      tool_name,
      tool_kind,
      runtime: "langgraph",
    },
    error: traceError(error),
  });
}

export function createLangGraphToolNode(
  names: string[],
  opts: LangGraphToolOptions = {},
): ToolNode {
  return new ToolNode(names.map((name) => createLangGraphTool(name, opts)));
}

export function listLangGraphToolNames(): string[] {
  return listTools().map((tool) => tool.name).sort();
}

function traceError(
  error: unknown,
): Error | { message: string; name?: string | null } | null {
  if (!error) return null;
  if (error instanceof Error) return error;
  return { message: String(error) };
}

function toolContextFromState(
  state: Partial<BombsellLangGraphState>,
  defaults: Partial<ToolContext> = {},
): ToolContext {
  const workspace_id = state.workspace_id ?? defaults.workspace_id;
  if (!workspace_id) {
    throw new Error("LangGraph tool invocation requires workspace_id in state or default context.");
  }
  return {
    workspace_id,
    user_id: defaults.user_id,
    rep_id: state.rep_id ?? defaults.rep_id,
    run_id: state.run_id ?? defaults.run_id,
    causation_id: state.causation_event_id ?? defaults.causation_id,
    correlation_id: state.correlation_id ?? defaults.correlation_id,
  };
}
