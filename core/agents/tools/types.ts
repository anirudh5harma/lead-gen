import type { z } from "zod";

/**
 * Tool envelope — the universal calling convention for everything the agent
 * fabric can invoke. Every integration (Gmail, LinkedIn, Apollo, HubSpot,
 * the local knowledge graph) is exposed as one or more Tools. The same
 * Tool registry is what internal Reps call AND what we expose over MCP
 * (core/mcp/) to external agents.
 *
 * Hard rules (see core/agents/README.md):
 *   * Tools are always MCP-shaped. A Tool has a name, a human-readable
 *     description, an `input` Zod schema, an `output` Zod schema, and a
 *     handler.
 *   * Tools are workspace-scoped. Every invocation carries a ToolContext
 *     with workspace_id, the calling Rep, and the correlation_id of the
 *     enclosing workflow / event.
 *   * Tools are side-effect-explicit: the `kind` declares whether the tool
 *     is `read`, `write`, or `external` (touches the outside world). The
 *     workflow runtime gates `write` and `external` calls behind autonomy
 *     policy.
 */

export type ToolKind = "read" | "write" | "external";

export interface ToolContext {
  workspace_id: string;
  /** The Rep on whose behalf this tool is being invoked, when applicable. */
  rep_id?: string;
  /** The enclosing workflow run, when called from a workflow step. */
  run_id?: string;
  /** Causation: the event or step that triggered this invocation. */
  causation_id?: string;
  /** Correlation across the whole flow. */
  correlation_id?: string;
}

export interface ToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  /** Stable, namespaced name: `gmail.send`, `graph.persons.find`, ... */
  name: string;
  /** One-sentence description for LLM tool selection. */
  description: string;
  kind: ToolKind;
  input: I;
  output: O;
  /** The action. Must validate input and return data matching `output`. */
  handler: (input: z.infer<I>, ctx: ToolContext) => Promise<z.infer<O>>;
}

export interface ToolInvocationTrace<I = unknown, O = unknown> {
  tool: string;
  input: I;
  output?: O;
  error?: { message: string; stack?: string };
  started_at: string;
  ended_at: string;
  duration_ms: number;
  ctx: ToolContext;
}
