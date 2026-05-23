/**
 * MCP server — Surface Layer.
 *
 * Per ARCHITECTURE.md, the MCP surface IS the product API: every Tool the
 * internal Reps call is also callable by external agents. This module is
 * the envelope; the HTTP / SSE / stdio transport binding lives in
 * `app/api/mcp/route.ts` (added when the route lands).
 */

export { createBombsellMcpServer } from "./server.ts";
export type { CreateBombsellMcpServerOptions } from "./server.ts";
