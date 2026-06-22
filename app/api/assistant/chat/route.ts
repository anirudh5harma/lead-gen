import {
  AssistantChatRequestSchema,
} from "../../../../core/product/assistant/types.ts";
import {
  assertAssistantSessionAllowed,
  assertAssistantToolAllowed,
  isAssistantUsageCapExceededError,
} from "../../../../core/product/assistant/telemetry.ts";
import { streamAssistantResponse } from "../../../../core/product/assistant/orchestrator.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
} as const;

export async function POST(request: Request): Promise<Response> {
  return handleAssistantChatRequest(request);
}

async function loadActiveWorkspaceSession() {
  const { getActiveWorkspaceSession } = await import(
    "../../../../lib/workspace.ts"
  );
  return getActiveWorkspaceSession();
}

function encodeEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

export async function handleAssistantChatRequest(
  request: Request,
  deps: {
    assertSessionAllowed?: typeof assertAssistantSessionAllowed;
    assertToolAllowed?: typeof assertAssistantToolAllowed;
    getSession?: typeof loadActiveWorkspaceSession;
    streamAssistant?: typeof streamAssistantResponse;
  } = {},
): Promise<Response> {
  const active = await (deps.getSession ?? loadActiveWorkspaceSession)();
  if (!active?.user_id) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = AssistantChatRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Valid message and optional history are required." },
      { status: 400 },
    );
  }

  try {
    await (deps.assertSessionAllowed ?? assertAssistantSessionAllowed)({
      workspaceId: active.workspace.id,
    });
    await (deps.assertToolAllowed ?? assertAssistantToolAllowed)({
      workspaceId: active.workspace.id,
    });
  } catch (error) {
    if (isAssistantUsageCapExceededError(error)) {
      return Response.json({ error: error.message }, { status: 429 });
    }
    console.error("[assistant/chat] usage guard failed", error);
    return Response.json(
      { error: "Assistant chat request failed." },
      { status: 503 },
    );
  }

  const streamAssistant = deps.streamAssistant ?? streamAssistantResponse;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of streamAssistant({
          workspaceId: active.workspace.id,
          userId: active.user_id,
          message: parsed.data.message,
          history: parsed.data.history,
        })) {
          if (event.type === "text-delta") {
            controller.enqueue(encodeEvent("text-delta", { text: event.text }));
            continue;
          }
          if (event.type === "card") {
            controller.enqueue(encodeEvent("card", event.card));
            continue;
          }
          if (event.type === "confirmation") {
            controller.enqueue(
              encodeEvent("confirmation", {
                confirmation: event.confirmation,
                card: event.card,
                call_id: event.call_id,
              }),
            );
            continue;
          }
          if (event.type === "done") {
            controller.enqueue(
              encodeEvent("done", { finish_reason: event.finish_reason }),
            );
            controller.close();
            return;
          }
          controller.enqueue(encodeEvent("error", { error: event.error }));
          controller.close();
          return;
        }

        controller.enqueue(encodeEvent("done", { finish_reason: "stop" }));
        controller.close();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Assistant chat request failed.";
        controller.enqueue(encodeEvent("error", { error: message }));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: SSE_HEADERS,
  });
}
