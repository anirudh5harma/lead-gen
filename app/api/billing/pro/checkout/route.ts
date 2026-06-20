import { NextResponse } from "next/server";
import {
  createSubscriptionCheckoutUrl,
  getDodoConfigSummary,
  type DodoProBillingPeriod,
} from "@/core/billing/index.ts";
import {
  createProductWorkspaceForUser,
} from "@/core/product/app";
import { getRequestAuthIdentity } from "@/lib/auth";
import { googleAuthPath } from "@/lib/auth/next";
import {
  getActiveWorkspaceSession,
  setActiveWorkspaceCookie,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  }

  try {
    const checkoutUrl = await createSubscriptionCheckoutUrl({
      userEmail: identity.email ?? `${identity.id}@users.bombsell.local`,
      userName: displayNameFromEmail(identity.email) ?? "Bombsell customer",
      userId: identity.id,
      workspaceId: workspace.workspace.id,
      period,
      returnUrl: new URL("/dashboard/settings?billing=pro", url).toString(),
      cancelUrl: new URL("/pricing", url).toString(),
    });
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
