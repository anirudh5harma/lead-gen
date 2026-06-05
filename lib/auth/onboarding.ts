import type { Pool } from "pg";
import { reconcileWorkspaceMembershipsForAuthIdentity } from "../../core/product/app.ts";
import { getPool } from "../../core/substrate/storage/index.ts";
import type { RequestAuthIdentity } from "../auth.ts";

export interface CompletedOnboarding {
  workspace_id: string;
  completion_source:
    | "workspace_company_profile"
    | "activated_workspace"
    | "accepted_workspace";
}

interface AuthOnboardingDeps {
  reconcileWorkspaceMemberships?: typeof reconcileWorkspaceMembershipsForAuthIdentity;
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
           select 1
             from events e
            where e.workspace_id = w.id
              and e.event_type = 'workspace.company.profiled'
         ) as has_workspace_company_profile_event,
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
         when has_workspace_company_profile or has_workspace_company_profile_event then 'workspace_company_profile'
         when has_rep
          and has_play
          and has_icp
          and (has_signal_source or has_company_memory) then 'activated_workspace'
         else 'accepted_workspace'
       end as completion_source
      from candidate_workspaces
      order by
        case
          when has_workspace_company_profile or has_workspace_company_profile_event then 3
          when has_rep
           and has_play
           and has_icp
           and (has_signal_source or has_company_memory) then 2
          else 1
        end desc,
        created_at desc,
        workspace_id desc
      limit 1`,
    [userId],
  );
  return rows[0] ?? null;
}

export async function findCompletedOnboardingForAuthIdentity(
  identity: RequestAuthIdentity,
  pool: Pool = getPool(),
  deps: AuthOnboardingDeps = {},
): Promise<CompletedOnboarding | null> {
  const completed = await findCompletedOnboardingForUser(identity.id, pool);
  if (completed) return completed;

  if (identity.email && identity.email_verified) {
    const reconcile =
      deps.reconcileWorkspaceMemberships ?? reconcileWorkspaceMembershipsForAuthIdentity;
    const reconciled = await reconcile({
      user_id: identity.id,
      email: identity.email,
      email_verified: true,
    }, { pool });
    if (reconciled.length > 0) {
      return findCompletedOnboardingForUser(identity.id, pool);
    }
  }
  return null;
}
