import { getPortalUrl } from "@/core/billing/index.ts";
import { canUseWorkspaceOps, getActiveWorkspaceSession } from "@/lib/workspace";
import { getPool } from "@/core/substrate/storage/index.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Opens the Dodo customer portal for the active workspace — where a Pro user
 * manages or cancels their subscription (cancel-at-period-end). Returns
 * `{ url }` for the client to redirect to.
 */
export async function POST(request: Request): Promise<Response> {
  const workspace = await getActiveWorkspaceSession();
  if (!workspace) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!canUseWorkspaceOps(workspace)) {
    return Response.json(
      { error: "Workspace billing access requires owner or admin role." },
      { status: 403 },
    );
  }

  const { rows } = await getPool().query<{ dodo_customer_id: string | null }>(
    `select dodo_customer_id from workspaces where id = $1`,
    [workspace.workspace.id],
  );
  const customerId = rows[0]?.dodo_customer_id ?? null;
  if (!customerId) {
    return Response.json(
      { error: "No active subscription to manage." },
      { status: 400 },
    );
  }

  try {
    const url = new URL(request.url);
    const portalUrl = await getPortalUrl({
      customerId,
      returnUrl: new URL("/dashboard/profile#plan", url).toString(),
    });
    return Response.json({ url: portalUrl });
  } catch (err) {
    console.error("[billing/portal] dodo portal error", {
      error: err instanceof Error ? err.message : String(err),
      workspace_id: workspace.workspace.id,
    });
    return Response.json(
      { error: "Unable to open the billing portal right now." },
      { status: 503 },
    );
  }
}
