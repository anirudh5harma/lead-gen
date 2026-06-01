import { cookies } from "next/headers";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getRequestUserId, validUuid } from "@/lib/auth";

export interface ActiveWorkspace {
  id: string;
  slug: string;
  name: string;
}

export interface ActiveWorkspaceSession {
  workspace: ActiveWorkspace;
  user_id: string;
}

export const ACTIVE_WORKSPACE_COOKIE_NAME = "bs_ws";

export function activeWorkspaceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export async function hasWorkspaceAccess(
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await getPool().query<{ ok: boolean }>(
    `select exists (
       select 1 from workspace_members
        where workspace_id = $1 and user_id = $2 and accepted_at is not null
     ) as ok`,
    [workspaceId, userId],
  );
  return Boolean(rows[0]?.ok);
}

export async function getActiveWorkspaceSession(): Promise<ActiveWorkspaceSession | null> {
  const userId = await getRequestUserId();
  if (!userId) return null;

  const jar = await cookies();
  const selected = validUuid(jar.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value);
  const params: string[] = selected ? [userId, selected] : [userId];
  const selectedClause = selected ? "and w.id = $2" : "";
  const { rows } = await getPool().query<ActiveWorkspace>(
    `select w.id, w.slug::text as slug, w.name
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is null
        ${selectedClause}
      order by w.created_at desc
      limit 1`,
    params,
  );
  if (!rows[0]) return null;
  return { workspace: rows[0], user_id: userId };
}

export async function getActiveWorkspace(): Promise<ActiveWorkspace | null> {
  return (await getActiveWorkspaceSession())?.workspace ?? null;
}

export async function listWorkspaces(): Promise<ActiveWorkspace[]> {
  const userId = await getRequestUserId();
  if (!userId) return [];
  const { rows } = await getPool().query<ActiveWorkspace>(
    `select w.id, w.slug::text as slug, w.name
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is null
      order by w.created_at desc`,
    [userId],
  );
  return rows;
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
