import { createClient } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createBombsellMcpServer } from "@/core/mcp/index.ts";
import { findFirstProductWorkspaceForUser } from "@/core/product/app.ts";
import { registerProductTools } from "@/core/product/tools.ts";
import { registerGraphTools } from "@/core/graph/index.ts";
import { validUuid, getRequestUserId } from "@/lib/auth";
import {
  getActiveWorkspaceSession,
  hasWorkspaceAccess,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    return handleMcpRequest(request);
  }

  const auth = await resolveMcpAuth(request);
  if (!auth) {
    return Response.json(mcpManifest(null), {
      status: 401,
      headers: {
        ...corsHeaders(),
        "WWW-Authenticate": "Bearer",
      },
    });
  }

  return Response.json(mcpManifest(auth.workspace_id), { headers: corsHeaders() });
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const auth = await resolveMcpAuth(request);
  if (!auth) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized" },
      },
      {
        status: 401,
        headers: {
          ...corsHeaders(),
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  registerGraphTools();
  registerProductTools();

  const server = createBombsellMcpServer({
    workspaceId: auth.workspace_id,
    userId: auth.user_id,
    serverInfo: { name: "bombsell-mcp", version: "pivot-v2" },
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(request, {
    authInfo: {
      token: auth.token,
      clientId: `bombsell-user:${auth.user_id}`,
      scopes: ["bombsell:read", "bombsell:write"],
    },
  });

  return withCors(response);
}

interface McpAuth {
  token: string;
  user_id: string;
  workspace_id: string;
}

async function resolveMcpAuth(request: Request): Promise<McpAuth | null> {
  const token = bearerToken(request);
  const userId = token ? await userIdFromBearer(token) : await getRequestUserId();
  if (!userId) return null;

  const workspaceId = await resolveWorkspaceId(request, userId);
  if (!workspaceId) return null;

  return {
    token: token ?? "cookie-session",
    user_id: userId,
    workspace_id: workspaceId,
  };
}

async function userIdFromBearer(token: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return null;
  return validUuid(data.user?.id);
}

async function resolveWorkspaceId(
  request: Request,
  userId: string,
): Promise<string | null> {
  const url = new URL(request.url);
  const requested =
    validUuid(request.headers.get("x-bombsell-workspace-id")) ??
    validUuid(url.searchParams.get("workspace_id"));
  if (requested) {
    return (await hasWorkspaceAccess(requested, userId)) ? requested : null;
  }

  const active = await getActiveWorkspaceSession();
  if (active?.user_id === userId) return active.workspace.id;

  return findFirstProductWorkspaceForUser(userId);
}

function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const [scheme, token] = auth.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() || null;
}

function mcpManifest(workspaceId: string | null) {
  return {
    name: "bombsell-mcp",
    transport: "streamable-http",
    endpoint: "/api/mcp",
    auth: "Authorization: Bearer <Supabase user access token>",
    workspace_id: workspaceId,
    tools: [
      "product.state.get",
      "product.company.website_profile.extract",
      "product.company.profile.configure",
      "product.rep.configure",
      "product.icp.configure",
      "product.play.signal_email.configure",
      "product.email_account.configure",
      "product.company.track",
      "product.source.configure",
      "product.activation.configure",
      "product.sources.default_aggregator.configure",
      "product.sources.aggregate.run",
      "product.signal.submit",
      "product.signals.dispatch_plays",
      "product.approval.decide",
      "product.workflow.retry",
      "product.sending_domain.operate",
      "graph.companies.*",
      "graph.persons.*",
      "graph.sources.*",
      "graph.edges.*",
    ],
  };
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, X-Bombsell-Workspace-Id",
    "Access-Control-Expose-Headers": "MCP-Session-Id",
  };
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
