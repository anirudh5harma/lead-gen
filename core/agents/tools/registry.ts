import type { z } from "zod";
import type {
  ToolContext,
  ToolDefinition,
  ToolInvocationTrace,
} from "./types.ts";

/**
 * The Tool registry. Singleton per process. Tools register at module load
 * time (see core/channels/* and core/graph/* — those modules each export
 * their tools by importing this registry and calling `registerTool`).
 *
 * `invokeTool` is the single call site for executing a Tool. It:
 *   1. Looks up the tool
 *   2. Validates input against the schema
 *   3. Calls the handler
 *   4. Validates output against the schema
 *   5. Records a trace via the optional observer
 *
 * MCP server (core/mcp/) reads from the same registry to expose tools to
 * external agents.
 */

export interface ToolObserver {
  (trace: ToolInvocationTrace): void | Promise<void>;
}

const tools = new Map<string, ToolDefinition>();
const observers = new Set<ToolObserver>();

export function registerTool<
  I extends z.ZodTypeAny,
  O extends z.ZodTypeAny,
>(def: ToolDefinition<I, O>): void {
  if (tools.has(def.name)) {
    throw new Error(`Tool already registered: ${def.name}`);
  }
  tools.set(def.name, def as ToolDefinition);
}

export function unregisterTool(name: string): void {
  tools.delete(name);
}

export function getTool(name: string): ToolDefinition | undefined {
  return tools.get(name);
}

export function listTools(filter?: { kind?: "read" | "write" | "external" }): ToolDefinition[] {
  const all = Array.from(tools.values());
  return filter?.kind ? all.filter((t) => t.kind === filter.kind) : all;
}

export function observeToolInvocations(observer: ToolObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export async function invokeTool<O = unknown>(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<O> {
  const def = tools.get(name);
  if (!def) throw new Error(`Unknown tool: ${name}`);

  const started_at = new Date();
  const parsedInput = def.input.parse(input);

  let output: unknown;
  let err: Error | undefined;
  try {
    output = await def.handler(parsedInput, ctx);
    output = def.output.parse(output);
  } catch (e) {
    err = e instanceof Error ? e : new Error(String(e));
  }

  const ended_at = new Date();
  const trace: ToolInvocationTrace = {
    tool: name,
    input: parsedInput,
    output: err ? undefined : output,
    error: err ? { message: err.message, stack: err.stack } : undefined,
    started_at: started_at.toISOString(),
    ended_at: ended_at.toISOString(),
    duration_ms: ended_at.getTime() - started_at.getTime(),
    ctx,
  };
  for (const observer of observers) {
    try {
      const r = observer(trace);
      if (r instanceof Promise) r.catch((e) => console.error("[tool-observer]", e));
    } catch (e) {
      console.error("[tool-observer]", e);
    }
  }

  if (err) throw err;
  return output as O;
}

/** Test helper: drop every registered tool and observer. */
export function _resetToolRegistry(): void {
  tools.clear();
  observers.clear();
}
