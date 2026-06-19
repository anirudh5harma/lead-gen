import { createClient } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createBombsellMcpServer } from "@/core/mcp/index.ts";
import { createMcpManifest } from "@/core/mcp/manifest.ts";
import { findFirstProductWorkspaceForUser } from "@/core/product/app.ts";
import { registerProductTools } from "@/core/product/tools.ts";
import { registerGraphTools } from "@/core/graph/index.ts";
import { registerExaTools } from "@/core/exa/index.ts";
import {
  BOMBSELL_MCP_OAUTH_SCOPES,
  protectedResourceMetadataUrl,
} from "@/core/mcp/oauth-metadata.ts";
import { tokenHash, validateMcpAccessToken } from "@/core/mcp/oauth.ts";
import { createJournaledDispatchEventBus } from "@/core/substrate/events/index.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
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
    return Response.json(createMcpManifest(null), {
      status: 401,
      headers: {
        ...corsHeaders(),
        "WWW-Authenticate": mcpAuthenticateHeader(request),
      },
    });
  }

  return Response.json(createMcpManifest(auth.workspace_id), { headers: corsHeaders() });
}

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
  return handleMcpRequest(request);
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const toolCalls = await readMcpToolCalls(request);
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
          "WWW-Authenticate": mcpAuthenticateHeader(request),
        },
      },
    );
  }

  registerGraphTools();
  registerExaTools();
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
      clientId: auth.client_id ?? `bombsell-user:${auth.user_id}`,
      scopes: auth.scopes,
    },
  });

  await publishMcpToolCallEvents({
    auth,
    response,
    startedAt,
    toolCalls,
  });

  return withCors(response);
}

interface McpAuth {
  token: string;
  user_id: string;
  workspace_id: string;
  client_id: string | null;
  scopes: string[];
}

interface McpToolCallAudit {
  request_id: string | number | null;
  tool_name: string;
}

async function resolveMcpAuth(request: Request): Promise<McpAuth | null> {
  const token = bearerToken(request);
  const oauthClaims = token?.startsWith("mcp_")
    ? await validateMcpAccessToken(token).catch((error) => {
      console.error("[mcp] OAuth token validation failed", error);
      return null;
    })
    : null;
  const userId = oauthClaims?.userId ??
    (token ? await userIdFromBearer(token) : await getRequestUserId());
  if (!userId) return null;

  const workspaceId = await resolveWorkspaceId(request, userId);
  if (!workspaceId) return null;

  return {
    token: token ?? "cookie-session",
    user_id: userId,
    workspace_id: workspaceId,
    client_id: oauthClaims?.clientId ?? null,
    scopes: oauthClaims?.scope?.split(/\s+/).filter(Boolean) ?? [...BOMBSELL_MCP_OAUTH_SCOPES],
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

async function readMcpToolCalls(request: Request): Promise<McpToolCallAudit[]> {
  if (request.method !== "POST") return [];
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("application/json")) return [];
  const body = await request.clone().json().catch(() => null) as unknown;
  const messages = Array.isArray(body) ? body : [body];
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const record = message as Record<string, unknown>;
    if (record.method !== "tools/call") return [];
    const params = record.params;
    const toolName =
      params && typeof params === "object" && "name" in params
        ? (params as { name?: unknown }).name
        : null;
    if (typeof toolName !== "string" || !toolName.trim()) return [];
    const requestId =
      typeof record.id === "string" || typeof record.id === "number"
        ? record.id
        : null;
    return [{ request_id: requestId, tool_name: toolName.trim() }];
  });
}

async function publishMcpToolCallEvents({
  auth,
  response,
  startedAt,
  toolCalls,
}: {
  auth: McpAuth;
  response: Response;
  startedAt: number;
  toolCalls: McpToolCallAudit[];
}): Promise<void> {
  if (toolCalls.length === 0) return;
  const status = await mcpResponseStatus(response);
  const bus = await createJournaledDispatchEventBus({ pool: getPool() });
  await Promise.all(
    toolCalls.map((call) =>
      bus.publish({
        workspace_id: auth.workspace_id,
        event_type: "mcp.tool.called",
        source: "agent",
        producer_ref: auth.client_id ?? `mcp:user:${auth.user_id}`,
        payload: {
          user_id: auth.user_id,
          client_id: auth.client_id,
          token_fingerprint: auth.token === "cookie-session"
            ? null
            : tokenHash(auth.token).slice(0, 16),
          tool_name: call.tool_name,
          request_id: call.request_id,
          status,
          http_status: response.status,
          latency_ms: Math.max(0, Date.now() - startedAt),
          mcp_method: "tools/call",
        },
      }).catch((error) => {
        console.error("[mcp] tool audit publish failed", {
          tool: call.tool_name,
          error,
        });
      })
    ),
  );
}

async function mcpResponseStatus(response: Response): Promise<"completed" | "errored"> {
  if (!response.ok) return "errored";
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) return "completed";
  const body = await response.clone().json().catch(() => null) as unknown;
  const messages = Array.isArray(body) ? body : [body];
  return messages.some((message) =>
    Boolean(
      message &&
        typeof message === "object" &&
        "error" in message,
    )
  )
    ? "errored"
    : "completed";
}

function mcpAuthenticateHeader(request: Request): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(request)}"`;
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
