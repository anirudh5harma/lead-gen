import { cookies } from "next/headers";
import { getPool } from "@/core/substrate/storage/index.ts";

/**
 * Workspace selection for the dashboard. Foundation lacks a real auth
 * layer — `pivot-v2`'s identity story is still TODO. As a pragmatic
 * substitute, the dashboard reads the active workspace from a cookie
 * (`bs_ws`). If unset, we fall back to the most recently created
 * workspace in the database so a fresh demo "just works" after running
 * the seed.
 *
 * The active workspace id is intentionally NOT a security boundary in
 * the dashboard yet — every request to /dashboard renders that workspace's
 * data with no user-membership check. When auth lands, this helper becomes
 * the integration point: read the session, resolve the user's workspaces,
 * pick the active one, enforce membership.
 */

export interface ActiveWorkspace {
  id: string;
  slug: string;
  name: string;
}

const COOKIE_NAME = "bs_ws";

export async function getActiveWorkspace(): Promise<ActiveWorkspace | null> {
  const jar = await cookies();
  const fromCookie = jar.get(COOKIE_NAME)?.value;
  const pool = getPool();
  if (fromCookie) {
    const { rows } = await pool.query<ActiveWorkspace>(
      `select id, slug, name from workspaces where id = $1 and archived_at is null`,
      [fromCookie],
    );
    if (rows[0]) return rows[0];
  }
  // Fallback: newest non-archived workspace.
  const { rows } = await pool.query<ActiveWorkspace>(
    `select id, slug, name from workspaces
      where archived_at is null
      order by created_at desc
      limit 1`,
  );
  return rows[0] ?? null;
}

export async function listWorkspaces(): Promise<ActiveWorkspace[]> {
  const pool = getPool();
  const { rows } = await pool.query<ActiveWorkspace>(
    `select id, slug, name from workspaces
      where archived_at is null
      order by created_at desc`,
  );
  return rows;
}

/**
 * Server action — used by the workspace selector dropdown to swap the
 * active workspace. Sets the cookie; the caller redirects.
 */
export async function setActiveWorkspaceCookie(workspaceId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_NAME, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}
