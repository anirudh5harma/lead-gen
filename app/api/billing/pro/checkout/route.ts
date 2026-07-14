import { NextResponse } from "next/server";
import {
  createSubscriptionCheckoutUrl,
  getDodoConfigSummary,
  type DodoProBillingPeriod,
} from "@/core/billing/index.ts";
import {
  captureWorkspaceOwnerEmail,
  createProductWorkspaceForUser,
} from "@/core/product/app";
import { getRequestAuthIdentity } from "@/lib/auth";
import { googleAuthPath } from "@/lib/auth/next";
import {
  canUseWorkspaceOps,
  getActiveWorkspaceSession,
  setActiveWorkspaceCookie,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * JSON checkout for in-app buttons (dashboard banner, Profile plan section):
 * returns `{ url }` for the client to redirect to. The GET handler below stays
 * for marketing/pricing links that redirect server-side.
 */
export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"));
  const identity = await getRequestAuthIdentity();
  if (!identity) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }
  const workspace = await getActiveWorkspaceSession();
  if (!workspace) {
    return Response.json({ error: "No active workspace." }, { status: 400 });
  }
  if (!canUseWorkspaceOps(workspace)) {
    return Response.json(
      { error: "Workspace billing access requires owner or admin role." },
      { status: 403 },
    );
  }
  try {
    const [checkoutUrl] = await Promise.all([
      createSubscriptionCheckoutUrl({
        userEmail: identity.email ?? `${identity.id}@users.bombsell.local`,
        userName: displayNameFromEmail(identity.email) ?? "Bombsell customer",
        userId: identity.id,
        workspaceId: workspace.workspace.id,
        period,
        returnUrl: new URL("/dashboard/profile?billing=pro#plan", url).toString(),
        cancelUrl: new URL("/dashboard/profile#plan", url).toString(),
      }),
      captureOwnerEmailBestEffort(identity, workspace.workspace.id),
    ]);
    return Response.json({ url: checkoutUrl });
  } catch (err) {
    console.error("[billing/pro/checkout] POST dodo checkout error", {
      error: err instanceof Error ? err.message : String(err),
      workspace_id: workspace.workspace.id,
    });
    return Response.json(
      { error: "Unable to start Pro checkout right now." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const period = parsePeriod(url.searchParams.get("period"));
  const checkoutPath = `${url.pathname}?period=${period}`;
  const identity = await getRequestAuthIdentity();

  if (!identity) {
    return NextResponse.redirect(new URL(googleAuthPath(checkoutPath), url));
  }

  let workspace = await getActiveWorkspaceSession();
  if (!workspace) {
    const created = await createProductWorkspaceForUser(
      { name: "Bombsell Workspace", slug: "bombsell-workspace" },
      identity.id,
    );
    await setActiveWorkspaceCookie(created.id);
    workspace = {
      workspace: {
        id: created.id,
        slug: created.slug,
        name: created.name,
      },
      user_id: identity.id,
      role: "owner",
    };
  } else if (!canUseWorkspaceOps(workspace)) {
    return Response.json(
      { error: "Workspace billing access requires owner or admin role." },
      { status: 403 },
    );
  }

  try {
    const [checkoutUrl] = await Promise.all([
      createSubscriptionCheckoutUrl({
        userEmail: identity.email ?? `${identity.id}@users.bombsell.local`,
        userName: displayNameFromEmail(identity.email) ?? "Bombsell customer",
        userId: identity.id,
        workspaceId: workspace.workspace.id,
        period,
        returnUrl: new URL("/dashboard/settings?billing=pro", url).toString(),
        cancelUrl: new URL("/pricing", url).toString(),
      }),
      captureOwnerEmailBestEffort(identity, workspace.workspace.id),
    ]);
    return NextResponse.redirect(checkoutUrl, 303);
  } catch (err) {
    const config = getDodoConfigSummary();
    console.error("[billing/pro/checkout] dodo checkout error", {
      error: err instanceof Error ? err.message : String(err),
      config,
      period,
      workspace_id: workspace.workspace.id,
    });
    return Response.json(
      { error: "Unable to start Pro checkout right now." },
      { status: 502 },
    );
  }
}

function parsePeriod(value: string | null): DodoProBillingPeriod {
  return value === "annual" ? "annual" : "monthly";
}

function displayNameFromEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = email.split("@", 1)[0]?.trim();
  return local || email;
}

async function captureOwnerEmailBestEffort(
  identity: { id: string; email?: string | null },
  workspaceId: string,
): Promise<void> {
  if (!identity.email) return;
  try {
    await captureWorkspaceOwnerEmail(identity.email, {
      workspace_id: workspaceId,
      user_id: identity.id,
    });
  } catch (error) {
    console.warn("[billing/pro/checkout] owner email capture failed", {
      error: error instanceof Error ? error.message : String(error),
      workspace_id: workspaceId,
    });
  }
}
