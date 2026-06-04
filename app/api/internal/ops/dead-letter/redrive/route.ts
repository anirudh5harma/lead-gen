import type { NextRequest } from "next/server";
import { redriveDeadLetteredEventDispatch } from "@/core/product/app";
import { canUseWorkspaceOps, getActiveWorkspaceSession } from "@/lib/workspace";

/**
 * Operator-triggered redrive of one dead-lettered NATS dispatch. Resets
 * the dispatch row back to status='pending' with next_attempt_at=now()
 * so the redrive worker picks it up on the next pass.
 *
 * This is a *flip*, not a re-publish — the canonical event in `events`
 * remains the same; we're only nudging delivery. The product-layer wrapper
 * also emits `event.dispatch.redriven` so operator recovery stays auditably
 * visible on the typed event spine.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const eventId = req.nextUrl.searchParams.get("event_id");
  if (!eventId) {
    return new Response("missing event_id", { status: 400 });
  }
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!canUseWorkspaceOps(session)) {
    return new Response("forbidden", { status: 403 });
  }
  const redriven = await redriveDeadLetteredEventDispatch(eventId, {
    workspace_id: session.workspace.id,
    user_id: session.user_id,
  });
  if (!redriven) {
    return new Response("not found in dead-letter queue", { status: 404 });
  }
  // After redrive, send the operator back to the ops dashboard.
  return Response.redirect(new URL("/dashboard/ops", req.url), 303);
}
