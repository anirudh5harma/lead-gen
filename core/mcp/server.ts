import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  invokeTool,
  listTools,
  type ToolContext,
  type ToolDefinition,
} from "../agents/tools/index.ts";

/**
 * MCP server envelope. Exposes the agent fabric's Tool registry over the
 * Model Context Protocol so external agents (Claude desktop, ChatGPT,
 * customer agent frameworks) can call the SAME tools internal Reps use.
 *
 * This file is the envelope, not the transport: it constructs a configured
 * `McpServer` instance. Transport binding (HTTP / SSE / stdio) is a Surface
 * concern that lives in `app/api/mcp/route.ts` when the route lands.
 *
 * Workspace boundary: this server is instantiated PER WORKSPACE. The caller
 * (typically a Next.js route handler that has resolved the auth) supplies
 * `workspaceId` and any other ToolContext fields. The server NEVER routes
 * across workspaces; isolation is enforced at instantiation time.
 */

export interface CreateBombsellMcpServerOptions {
  workspaceId: string;
  /** Authenticated product user behind this MCP session, if known. */
  userId?: string;
  /** Optional rep on whose behalf calls are made (some Tools need this). */
  repId?: string;
  /** Optional filter — exclude tools by name or kind. */
  exposeKinds?: Array<"read" | "write" | "external">;
  excludeTools?: string[];
  /** Server metadata. */
  serverInfo?: { name?: string; version?: string };
}

function isZodObject(s: unknown): s is z.ZodObject<z.ZodRawShape> {
  // Zod 4: object schemas expose `.shape` and carry `_def.type === "object"`.
  // Zod 3 used `_def.typeName === "ZodObject"`. Check both for resilience.
  if (typeof s !== "object" || s === null) return false;
  const def = (s as { _def?: { type?: string; typeName?: string } })._def;
  if (def?.type === "object" || def?.typeName === "ZodObject") return true;
  const shape = (s as { shape?: unknown }).shape;
  return typeof shape === "object" && shape !== null;
}

export function createBombsellMcpServer(
  opts: CreateBombsellMcpServerOptions,
): McpServer {
  const server = new McpServer({
    name: opts.serverInfo?.name ?? "bombsell",
    version: opts.serverInfo?.version ?? "pivot-v2",
  });

  const allowedKinds = opts.exposeKinds ?? ["read", "write", "external"];
  const excluded = new Set(opts.excludeTools ?? []);

  const baseCtx: ToolContext = {
    workspace_id: opts.workspaceId,
    user_id: opts.userId,
    rep_id: opts.repId,
  };

  const tools = listTools().filter(
    (t) => allowedKinds.includes(t.kind) && !excluded.has(t.name),
  );

  for (const tool of tools) registerToolOnServer(server, tool, baseCtx);

  return server;
}

function registerToolOnServer(
  server: McpServer,
  tool: ToolDefinition,
  baseCtx: ToolContext,
): void {
  if (!isZodObject(tool.input)) {
    // MCP's registerTool expects a raw shape (the contents of z.object({...}))
    // rather than an arbitrary Zod schema. Tools that don't use ZodObject for
    // input can't be exposed automatically; surface that clearly rather than
    // silently dropping them.
    throw new Error(
      `Tool '${tool.name}' has a non-object input schema and cannot be exposed via MCP. ` +
        `Wrap the input in z.object({...}) or add a custom MCP adapter.`,
    );
  }

  // Map our internal kind to MCP's standard tool-annotation hints. These
  // help clients (and LLMs choosing tools) reason about side effects.
  const annotations =
    tool.kind === "read"
      ? { readOnlyHint: true, openWorldHint: false }
      : tool.kind === "external"
        ? { readOnlyHint: false, openWorldHint: true }
        : { readOnlyHint: false, openWorldHint: false };

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.input.shape,
      annotations,
    },
    async (args) => {
      const result = await invokeTool(tool.name, args, baseCtx);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result),
          },
        ],
      };
    },
  );
}
