import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import { redriveDeadLetteredDispatch } from "@/core/substrate/events/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";

/**
 * Operator-triggered redrive of one dead-lettered NATS dispatch. Resets
 * the dispatch row back to status='pending' with next_attempt_at=now()
 * so the redrive worker picks it up on the next pass.
 *
 * This is a *flip*, not a re-publish — the canonical event in `events`
 * remains the same; we're only nudging delivery. Therefore the route
 * works even if NATS is still down: the worker will retry the same way
 * the regular pending dispatch loop does.
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
  const redriven = await redriveDeadLetteredDispatch(getPool(), eventId, {
    workspace_id: session.workspace.id,
  });
  if (!redriven) {
    return new Response("not found in dead-letter queue", { status: 404 });
  }
  // After redrive, send the operator back to the ops dashboard.
  return Response.redirect(new URL("/dashboard/ops", req.url), 303);
}
