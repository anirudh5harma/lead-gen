export interface ActiveWorkspaceLookup {
  sql: string;
  params: string[];
}

export function excludeLegacySharedDefaultWorkspace(
  workspaceAlias: string,
  membershipAlias: string,
): string {
  return `not (
    ${workspaceAlias}.slug = 'default'
    and ${membershipAlias}.role <> 'owner'
    and exists (
      select 1
        from workspace_members legacy_wm
       where legacy_wm.workspace_id = ${workspaceAlias}.id
         and legacy_wm.accepted_at is not null
         and legacy_wm.user_id <> ${membershipAlias}.user_id
    )
  )`;
}

export function activeWorkspaceLookup(
  userId: string,
  selectedWorkspaceId: string | null,
): ActiveWorkspaceLookup {
  const params = selectedWorkspaceId ? [userId, selectedWorkspaceId] : [userId];
  const selectedOrder = selectedWorkspaceId
    ? "case when w.id = $2 then 0 else 1 end,"
    : "";
  return {
    params,
    sql: `select w.id, w.slug::text as slug, w.name, wm.role::text as role
       from workspaces w
       join workspace_members wm on wm.workspace_id = w.id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is null
        and ${excludeLegacySharedDefaultWorkspace("w", "wm")}
      order by ${selectedOrder} w.created_at desc, w.id desc
      limit 1`,
  };
}
