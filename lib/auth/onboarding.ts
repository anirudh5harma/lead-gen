import type { Pool } from "pg";
import { getPool } from "@/core/substrate/storage/index.ts";

export interface CompletedOnboarding {
  workspace_id: string;
}

export async function findCompletedOnboardingForUser(
  userId: string,
  pool: Pool = getPool(),
): Promise<CompletedOnboarding | null> {
  const { rows } = await pool.query<CompletedOnboarding>(
    `select w.id as workspace_id
       from workspace_members wm
       join workspaces w on w.id = wm.workspace_id
       join graph_companies gc on gc.workspace_id = w.id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is null
        and gc.properties->>'profile_role' = 'workspace_company'
      order by w.created_at desc, w.id desc
      limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}
