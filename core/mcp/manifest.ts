import { listTools } from "../agents/tools/index.ts";
import { registerExaTools } from "../exa/index.ts";
import { registerGraphTools } from "../graph/index.ts";
import { registerProductTools } from "../product/tools.ts";
import { BOMBSELL_MCP_INSTRUCTIONS } from "./instructions.ts";

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
    instructions: BOMBSELL_MCP_INSTRUCTIONS,
    product_surfaces: ["Brief", "Agent", "Profile"],
    recommended_entry_tool: "product.brief.get",
    tools: listTools().map((tool) => tool.name).sort(),
  };
}
