import type { Pool } from "pg";
import { getPool } from "@/core/substrate/storage/index.ts";

export interface CompletedOnboarding {
  workspace_id: string;
  completion_source: "workspace_company_profile" | "activated_workspace";
}

export async function findCompletedOnboardingForUser(
  userId: string,
  pool: Pool = getPool(),
): Promise<CompletedOnboarding | null> {
  const { rows } = await pool.query<CompletedOnboarding>(
    `with candidate_workspaces as (
       select
         w.id as workspace_id,
         w.created_at,
         exists (
           select 1
             from graph_companies gc
            where gc.workspace_id = w.id
              and gc.properties->>'profile_role' = 'workspace_company'
         ) as has_workspace_company_profile,
         exists (
           select 1 from graph_companies gc where gc.workspace_id = w.id
         ) as has_company_memory,
         exists (
           select 1 from graph_sources gs where gs.workspace_id = w.id
         ) as has_signal_source,
         exists (
           select 1 from workspace_icps wi where wi.workspace_id = w.id
         ) as has_icp,
         exists (
           select 1 from reps r where r.workspace_id = w.id
         ) as has_rep,
         exists (
           select 1 from plays p where p.workspace_id = w.id
         ) as has_play
       from workspace_members wm
       join workspaces w on w.id = wm.workspace_id
      where wm.user_id = $1
        and wm.accepted_at is not null
        and w.archived_at is null
     )
     select
       workspace_id,
       case
         when has_workspace_company_profile then 'workspace_company_profile'
         else 'activated_workspace'
       end as completion_source
      from candidate_workspaces
      where has_workspace_company_profile
         or (
           has_rep
           and has_play
           and has_icp
           and (has_signal_source or has_company_memory)
         )
      order by
        case when has_workspace_company_profile then 1 else 0 end desc,
        created_at desc,
        workspace_id desc
      limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}
