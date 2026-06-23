import { checkProductReadinessCached } from "../../../../core/product/health.ts";
import {
  canUseWorkspaceOps,
  getActiveWorkspaceSession,
} from "../../../../lib/workspace.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleReadinessRequest(req);
}

export async function handleReadinessRequest(
  req: Request,
  deps: {
    getSession?: typeof getActiveWorkspaceSession;
    getReadiness?: typeof checkProductReadinessCached;
  } = {},
): Promise<Response> {
  const session = await (deps.getSession ?? getActiveWorkspaceSession)();
  if (!session) {
    return Response.json({ error: "authentication required" }, { status: 401 });
  }
  if (!canUseWorkspaceOps(session)) {
    return Response.json({ error: "workspace operations access required" }, { status: 403 });
  }
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const readiness = await (deps.getReadiness ?? checkProductReadinessCached)({
    forceRefresh: fresh,
    liveProbes: fresh,
  });
  return Response.json(readiness, {
    status: readiness.ready ? 200 : 503,
    headers: {
      "cache-control": "no-store",
    },
  });
}
