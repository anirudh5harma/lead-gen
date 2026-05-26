import { hasDatabase } from "@/core/product/app";
import { briefEventPayload, formatBriefSseEvent } from "@/core/product/sse";
import { createPostgresEventBus } from "@/core/substrate/events/adapters/postgres";
import { getPool } from "@/core/substrate/storage";
import { getBriefWorkspaceSession } from "../session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  if (!hasDatabase()) {
    return new Response(null, { status: 204 });
  }

  const pool = getPool();
  const session = await getBriefWorkspaceSession();
  if (!session) return new Response(null, { status: 403 });

  const bus = await createPostgresEventBus({
    pool,
    workspaceId: session.workspace_id,
  });

  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(input: Parameters<typeof formatBriefSseEvent>[0]) {
        controller.enqueue(encoder.encode(formatBriefSseEvent(input)));
      }

      send({
        event: "brief.connected",
        retry: 2000,
        data: {
          workspace_id: session.workspace_id,
          connected_at: new Date().toISOString(),
        },
      });

      const subscription = await bus.subscribe("*", async (event) => {
        send({
          id: event.id,
          event: event.event_type,
          data: briefEventPayload(event),
        });
      });

      heartbeat = setInterval(() => {
        send({
          event: "brief.heartbeat",
          data: { at: new Date().toISOString() },
        });
      }, 25_000);

      request.signal.addEventListener(
        "abort",
        () => {
          void subscription.unsubscribe().finally(async () => {
            if (heartbeat) clearInterval(heartbeat);
            await bus.close();
            controller.close();
          });
        },
        { once: true },
      );
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat);
      await bus.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
