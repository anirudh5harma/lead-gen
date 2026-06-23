import { cookies } from "next/headers";
import { cache } from "react";
import { getPool } from "@/core/substrate/storage/index.ts";
import { AUTH_SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session-cookie";
import { getRequestUserId, validUuid } from "@/lib/auth";
import {
  activeWorkspaceLookup,
  excludeLegacySharedDefaultWorkspace,
  workspaceAccessLookup,
} from "@/lib/workspace-selection";
import type { WorkspaceRole } from "@/lib/workspace-access";

export interface ActiveWorkspace {
  id: string;
  slug: string;
  name: string;
}

export interface ActiveWorkspaceSession {
  workspace: ActiveWorkspace;
  user_id: string;
  role: WorkspaceRole;
}

export const ACTIVE_WORKSPACE_COOKIE_NAME = "bs_ws";

export function activeWorkspaceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  };
}

export async function hasWorkspaceAccess(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const lookup = workspaceAccessLookup(workspaceId, userId);
  const { rows } = await getPool().query<{ ok: boolean }>(lookup.sql, lookup.params);
  return Boolean(rows[0]?.ok);
}

export const getActiveWorkspaceSession = cache(async (): Promise<ActiveWorkspaceSession | null> => {
  const userId = await getRequestUserId();
  if (!userId) return null;

  const jar = await cookies();
  const selected = validUuid(jar.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value);
  const lookup = activeWorkspaceLookup(userId, selected);
  const { rows } = await getPool().query<ActiveWorkspace & { role: WorkspaceRole }>(
    lookup.sql,
    lookup.params,
  );
  if (!rows[0]) return null;
  const { role, ...workspace } = rows[0];
  return { workspace, user_id: userId, role };
});

export async function getActiveWorkspaceSessionForDashboard(
  surface: string,
): Promise<ActiveWorkspaceSession | null> {
  try {
    return await getActiveWorkspaceSession();
  } catch (err) {
    console.error(`[dashboard/${surface}] failed to load active workspace`, err);
    return null;
  }
}

export async function getActiveWorkspace(): Promise<ActiveWorkspace | null> {
  return (await getActiveWorkspaceSession())?.workspace ?? null;
}

export const listWorkspaces = cache(async (): Promise<ActiveWorkspace[]> => {
  const userId = await getRequestUserId();
  if (!userId) return [];
  const { rows } = await getPool().query<ActiveWorkspace>(
    `select w.id, w.slug::text as slug, w.name
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is null
        and ${excludeLegacySharedDefaultWorkspace("w", "wm")}
      order by w.created_at desc`,
    [userId],
  );
  return rows;
});

export async function listWorkspacesForDashboard(
  surface: string,
): Promise<ActiveWorkspace[]> {
  try {
    return await listWorkspaces();
  } catch (err) {
    console.error(`[dashboard/${surface}] failed to list workspaces`, err);
    return [];
  }
}

export async function setActiveWorkspaceCookie(workspaceId: string): Promise<void> {
  const userId = await getRequestUserId();
  const id = validUuid(workspaceId);
  if (!userId || !id || !(await hasWorkspaceAccess(id, userId))) {
    throw new Error("workspace access denied");
  }
  const jar = await cookies();
  jar.set(ACTIVE_WORKSPACE_COOKIE_NAME, id, activeWorkspaceCookieOptions());
}

export { canUseWorkspaceOps } from "@/lib/workspace-access";
