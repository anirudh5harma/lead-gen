import { listTools } from "../agents/tools/index.ts";
import { registerExaTools } from "../exa/index.ts";
import { registerGraphTools } from "../graph/index.ts";
import { registerProductTools } from "../product/tools.ts";

export function createMcpManifest(workspaceId: string | null) {
  registerGraphTools();
  registerExaTools();
  registerProductTools();
  return {
    name: "bombsell-mcp",
    transport: "streamable-http",
    endpoint: "/api/mcp",
    auth: "Authorization: Bearer <Supabase user access token>",
    workspace_id: workspaceId,
    tools: listTools().map((tool) => tool.name).sort(),
  };
}
