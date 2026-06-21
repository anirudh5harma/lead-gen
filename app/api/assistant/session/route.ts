import {
  AssistantSessionRequestSchema,
  AssistantSessionResponseSchema,
} from "../../../../core/product/assistant/types.ts";
import {
  startAssistantRealtimeSession,
  assistantVoice,
} from "../../../../core/product/assistant/session.ts";
import {
  assertAssistantSessionAllowed,
  isAssistantUsageCapExceededError,
  publishAssistantSessionStarted,
} from "../../../../core/product/assistant/telemetry.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Realtime handshake + retries can exceed the platform default; give it room.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleAssistantSessionRequest(request);
}

async function loadActiveWorkspaceSession() {
  const { getActiveWorkspaceSession } = await import(
    "../../../../lib/workspace.ts"
  );
  return getActiveWorkspaceSession();
}

export async function handleAssistantSessionRequest(
  request: Request,
  deps: {
    getSession?: typeof loadActiveWorkspaceSession;
    publishStarted?: typeof publishAssistantSessionStarted;
    assertSessionAllowed?: typeof assertAssistantSessionAllowed;
    startRealtime?: typeof startAssistantRealtimeSession;
  } = {},
): Promise<Response> {
  const active = await (deps.getSession ?? loadActiveWorkspaceSession)();
  if (!active?.user_id) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = AssistantSessionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Valid sdp and mode are required." },
      { status: 400 },
    );
  }

  try {
    await (deps.assertSessionAllowed ?? assertAssistantSessionAllowed)({
      workspaceId: active.workspace.id,
    });
  } catch (error) {
    if (isAssistantUsageCapExceededError(error)) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    console.error("[assistant/session] usage guard failed", error);
    return Response.json(
      { error: "Failed to start assistant session." },
      { status: 503 },
    );
  }

  try {
    const session = await (deps.startRealtime ?? startAssistantRealtimeSession)({
      sdp: parsed.data.sdp,
      mode: parsed.data.mode,
      userId: active.user_id,
    });
    await (deps.publishStarted ?? publishAssistantSessionStarted)({
      workspaceId: active.workspace.id,
      userId: active.user_id,
      mode: parsed.data.mode,
      callId: session.callId,
      voice: assistantVoice(),
    }).catch((error) => {
      console.error("[assistant/session] telemetry publish failed", error);
    });

    return Response.json(
      AssistantSessionResponseSchema.parse({
        ok: true,
        sdp: session.sdp,
        mode: parsed.data.mode,
        call_id: session.callId,
      }),
      { status: 200 },
    );
  } catch (error) {
    console.error("[assistant/session] failed to start realtime session", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to start assistant session.",
      },
      { status: 503 },
    );
  }
}
