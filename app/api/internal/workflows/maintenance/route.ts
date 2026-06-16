import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { Pool } from "pg";
import { getPool } from "../../../../../core/substrate/storage/index.ts";
import {
  createRestateWorkflowRuntime,
  restateBearerFromEnv,
  triggerDueWorkspaceMaintenance,
  type WorkflowRuntime,
  type WorkspaceMaintenanceTriggerDeps,
  type WorkspaceMaintenanceTriggerSummary,
} from "../../../../../core/substrate/workflows/index.ts";

/**
 * Control-plane entry point for routine platform and tenant-scoped work. The
 * caller only starts keyed Restate invocations; all product mutations remain
 * in durable workflows and their typed-event projections.
 *
 * Scheduling (production):
 *   - Vercel Cron (see vercel.json) hits this route every 5 minutes with
 *     `Authorization: Bearer ${CRON_SECRET}`.
 *   - Any external scheduler (GitHub Actions, k8s CronJob, etc.) can call
 *     it directly with `Authorization: Bearer ${MAINTENANCE_TRIGGER_SECRET}`.
 *   - We accept either env var (or both, set to the same value) so the
 *     same route serves both schedulers without forking config.
 *
 * GET is supported because Vercel Cron defaults to GET; the auth check is
 * identical to POST.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export interface MaintenanceRouteDeps {
  allowedSecrets?: string[];
  ingressUrl?: string;
  bearer?: string | null;
  pool?: Pool;
  runtime?: Pick<WorkflowRuntime, "start">;
  trigger?: (
    deps: WorkspaceMaintenanceTriggerDeps,
  ) => Promise<WorkspaceMaintenanceTriggerSummary>;
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleMaintenanceRequest(req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handleMaintenanceRequest(req);
}

export async function handleMaintenanceRequest(
  req: Pick<Request, "headers">,
  deps: MaintenanceRouteDeps = {},
): Promise<Response> {
  const allowedSecrets = deps.allowedSecrets ?? collectAllowedSecrets();
  if (allowedSecrets.length === 0) {
    return new Response(
      "MAINTENANCE_TRIGGER_SECRET or CRON_SECRET must be set",
      { status: 500 },
    );
  }
  if (!hasAnyBearerSecret(req.headers.get("authorization"), allowedSecrets)) {
    return new Response("unauthorized", { status: 401 });
  }

  const ingressUrl = deps.ingressUrl ?? process.env.RESTATE_INGRESS_URL;
  if (!deps.runtime && !ingressUrl) {
    return new Response("RESTATE_INGRESS_URL is not set", { status: 500 });
  }

  try {
    const workflowRuntime = deps.runtime ?? createRestateWorkflowRuntime({
      ingressUrl: ingressUrl!,
      bearer: deps.bearer ?? restateBearerFromEnv(),
    });
    const summary = await (deps.trigger ?? triggerDueWorkspaceMaintenance)({
      pool: deps.pool ?? getPool(),
      runtime: workflowRuntime,
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

function collectAllowedSecrets(): string[] {
  const out: string[] = [];
  const a = process.env.MAINTENANCE_TRIGGER_SECRET;
  const b = process.env.CRON_SECRET;
  if (a) out.push(a);
  if (b && b !== a) out.push(b);
  return out;
}

export function hasBearerSecret(
  authorization: string | null,
  expectedSecret: string,
): boolean {
  return hasAnyBearerSecret(authorization, [expectedSecret]);
}

export function hasAnyBearerSecret(
  authorization: string | null,
  expectedSecrets: string[],
): boolean {
  const prefix = "Bearer ";
  if (!authorization?.startsWith(prefix)) return false;
  const provided = Buffer.from(authorization.slice(prefix.length));
  for (const expected of expectedSecrets) {
    const exp = Buffer.from(expected);
    if (
      provided.length === exp.length &&
      timingSafeEqual(provided, exp)
    ) {
      return true;
    }
  }
  return false;
}
