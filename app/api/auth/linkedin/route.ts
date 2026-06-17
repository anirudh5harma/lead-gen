import type { NextRequest } from "next/server";
import { resolveLinkedInProviderAuthUrl } from "@/core/channels/linkedin/index.ts";
import { authCallbackOrigin } from "@/lib/auth/next";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { createLinkedInOAuthState } from "./state.ts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getActiveWorkspaceSession();
  if (!session) return new Response("authentication required", { status: 401 });

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return new Response("SESSION_SECRET is not set", { status: 500 });

  const providerAuthUrl = resolveLinkedInProviderAuthUrl();
  if (!providerAuthUrl) {
    return new Response("LINKEDIN_PROVIDER_AUTH_URL is not set", { status: 500 });
  }

  const state = createLinkedInOAuthState(
    {
      workspace_id: session.workspace.id,
      user_id: session.user_id,
    },
    sessionSecret,
  );
  providerAuthUrl.searchParams.set("state", state);
  providerAuthUrl.searchParams.set(
    "redirect_uri",
    process.env.LINKEDIN_REDIRECT_URI ??
      `${appOrigin(req)}/api/auth/linkedin/callback`,
  );

  return Response.redirect(providerAuthUrl.toString(), 302);
}

function appOrigin(req: NextRequest): string {
  return authCallbackOrigin({
    headers: req.headers,
    requestUrl: req.url,
  });
}
