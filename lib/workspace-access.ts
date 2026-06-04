export type WorkspaceRole = "owner" | "admin" | "member";

export interface WorkspaceRoleSession {
  role: WorkspaceRole;
}

export function canUseWorkspaceOps(session: WorkspaceRoleSession): boolean {
  return session.role === "owner" || session.role === "admin";
}
