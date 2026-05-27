import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getPool } from "@/core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  triggerDueWorkspaceMaintenance,
} from "@/core/substrate/workflows/index.ts";

/**
 * Control-plane entry point for routine platform and tenant-scoped work. The
 * caller only starts keyed Restate invocations; all product mutations remain
 * in durable workflows and their typed-event projections.
 */
export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MAINTENANCE_TRIGGER_SECRET;
  if (!secret) {
    return new Response("MAINTENANCE_TRIGGER_SECRET is not set", { status: 500 });
  }
  if (!hasBearerSecret(req.headers.get("authorization"), secret)) {
    return new Response("unauthorized", { status: 401 });
  }

  const ingressUrl = process.env.RESTATE_INGRESS_URL;
  if (!ingressUrl) {
    return new Response("RESTATE_INGRESS_URL is not set", { status: 500 });
  }

  try {
    const summary = await triggerDueWorkspaceMaintenance({
      pool: getPool(),
      runtime: createRestateWorkflowRuntime({ ingressUrl }),
    });
    return Response.json(summary, {
      status: summary.failures.length === 0 ? 202 : 207,
    });
  } catch (err) {
    return new Response(
      err instanceof Error ? `maintenance discovery failed: ${err.message}` : "maintenance discovery failed",
      { status: 503 },
    );
  }
}

export function hasBearerSecret(
  authorization: string | null,
  expectedSecret: string,
): boolean {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return false;
  const provided = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(expectedSecret);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}
