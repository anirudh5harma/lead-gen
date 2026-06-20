import { handleAssistantToolRequest as runAssistantToolRequest } from "../../../../core/product/assistant/controller.ts";
import { publishAssistantToolCalled } from "../../../../core/product/assistant/telemetry.ts";
import { AssistantToolRequestSchema } from "../../../../core/product/assistant/types.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleAssistantToolRequest(request);
}

async function loadActiveWorkspaceSession() {
  const { getActiveWorkspaceSession } = await import(
    "../../../../lib/workspace.ts"
  );
  return getActiveWorkspaceSession();
}

export async function handleAssistantToolRequest(
  request: Request,
  deps: {
    getSession?: typeof loadActiveWorkspaceSession;
    publishToolCalled?: typeof publishAssistantToolCalled;
    runToolRequest?: typeof runAssistantToolRequest;
  } = {},
): Promise<Response> {
  const startedAt = Date.now();
  const active = await (deps.getSession ?? loadActiveWorkspaceSession)();
  if (!active?.user_id) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = AssistantToolRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Valid assistant tool request required." },
      { status: 400 },
    );
  }

  try {
    const result = await (deps.runToolRequest ?? runAssistantToolRequest)({
      body: parsed.data,
      workspaceId: active.workspace.id,
      userId: active.user_id,
    });

    await (deps.publishToolCalled ?? publishAssistantToolCalled)({
      workspaceId: active.workspace.id,
      userId: active.user_id,
      toolName:
        parsed.data.action === "invoke" ? parsed.data.tool_name : result.tool_name,
      callId: parsed.data.action === "invoke" ? parsed.data.call_id ?? null : null,
      requestId:
        parsed.data.action === "invoke" ? parsed.data.request_id ?? null : null,
      status:
        result.status === "requires_confirmation"
          ? "confirmation_pending"
          : result.status,
      requiresConfirmation: result.status === "requires_confirmation",
      latencyMs: Date.now() - startedAt,
    }).catch((error) => {
      console.error("[assistant/tool] telemetry publish failed", error);
    });

    return Response.json(result, {
      status:
        result.status === "errored"
          ? 422
          : result.status === "requires_confirmation"
            ? 202
            : 200,
    });
  } catch (error) {
    console.error("[assistant/tool] failed", error);
    const message =
      error instanceof Error ? error.message : "Assistant tool request failed.";

    await (deps.publishToolCalled ?? publishAssistantToolCalled)({
      workspaceId: active.workspace.id,
      userId: active.user_id,
      toolName:
        parsed.data.action === "invoke" ? parsed.data.tool_name : "confirmation",
      status: "errored",
      requiresConfirmation: false,
      latencyMs: Date.now() - startedAt,
    }).catch(() => {});

    return Response.json({ error: message }, { status: 500 });
  }
}
