import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createJournaledDispatchEventBus } from "@/core/substrate/events/index.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getRequestUserId, validUuid } from "@/lib/auth";
import { hasWorkspaceAccess } from "@/lib/workspace";
import { verifyLinkedInOAuthState } from "../state.ts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const url = req.nextUrl;
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return new Response(`LinkedIn provider error: ${oauthError}`, { status: 400 });
  }

  const stateToken = url.searchParams.get("state");
  const providerAccountId = url.searchParams.get("provider_account_id");
  if (!stateToken || !providerAccountId) {
    return new Response("missing state or provider_account_id", { status: 400 });
  }

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) return new Response("SESSION_SECRET is not set", { status: 500 });
  const state = verifyLinkedInOAuthState(stateToken, sessionSecret);
  if (!state) return new Response("invalid or expired state", { status: 400 });

  const userId = await getRequestUserId();
  if (
    !userId ||
    userId !== state.user_id ||
    !(await hasWorkspaceAccess(state.workspace_id, userId))
  ) {
    return new Response("workspace access denied", { status: 403 });
  }

  const channelAccountId =
    validUuid(url.searchParams.get("channel_account_id")) ?? randomUUID();
  const displayName =
    url.searchParams.get("display_name") ??
    url.searchParams.get("profile_name") ??
    "LinkedIn";
  const kind =
    url.searchParams.get("kind") === "linkedin_session"
      ? "linkedin_session"
      : "linkedin_oauth";
  const profileUrl = normalizeUrl(url.searchParams.get("profile_url"));
  const dailyCap = parseDailyCap(url.searchParams.get("daily_cap"));

  const bus = await createJournaledDispatchEventBus({ pool: getPool() });
  try {
    await bus.publish({
      workspace_id: state.workspace_id,
      event_type: "linkedin.account.authorization.received",
      source: "user",
      producer_ref: `user:${userId}`,
      idempotency_key: `linkedin-authorization:${channelAccountId}`,
      payload: {
        channel_account_id: channelAccountId,
        user_id: state.user_id,
        kind,
        display_name: displayName,
        provider_account_id: providerAccountId,
        profile_url: profileUrl,
        daily_cap: dailyCap,
      },
    });
  } finally {
    await bus.close();
  }

  const dest = new URL(state.return_to ?? "/dashboard/profile#linkedin", appOrigin(req));
  dest.searchParams.set("status", "linkedin_connecting");
  dest.searchParams.set("channel_account_id", channelAccountId);
  return Response.redirect(dest.toString(), 302);
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function parseDailyCap(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function appOrigin(req: NextRequest): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
