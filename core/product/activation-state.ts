import type { Pool } from "pg";

export interface WorkspaceActivationState {
  website_set: boolean;
  description_set: boolean;
  product_ready: boolean;
  setup_status?: "idle" | "running" | "failed";
  setup_run_id?: string | null;
}

interface ActivationStateRow {
  website_url: string | null;
  description: string | null;
  setup_status: string | null;
  setup_run_id: string | null;
}

export async function getWorkspaceActivationState(
  pool: Pool,
  workspace_id: string,
): Promise<WorkspaceActivationState> {
  const { rows } = await pool.query<ActivationStateRow>(
    `with profile as (
       select nullif(btrim(properties->>'website_url'), '') as website_url,
              nullif(btrim(description), '') as description
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc, created_at desc
        limit 1
     ), latest_setup as (
       select id as setup_run_id,
              status::text as setup_status
         from workflow_runs
        where workspace_id = $1
          and workflow_name = 'workspace.activation.setup'
        order by created_at desc, id desc
        limit 1
     )
     select profile.website_url,
            profile.description,
            latest_setup.setup_status,
            latest_setup.setup_run_id
       from (select 1) seed
       left join profile on true
       left join latest_setup on true`,
    [workspace_id],
  );
  const website_set = Boolean(rows[0]?.website_url);
  const description_set = Boolean(rows[0]?.description);
  const workflowStatus = rows[0]?.setup_status;
  const setup_status =
    workflowStatus === "pending" ||
    workflowStatus === "running" ||
    workflowStatus === "awaiting_approval" ||
    workflowStatus === "awaiting_event"
      ? "running"
      : workflowStatus === "failed" || workflowStatus === "cancelled"
        ? "failed"
        : "idle";
  return {
    website_set,
    description_set,
    product_ready: website_set && description_set,
    setup_status,
    setup_run_id: rows[0]?.setup_run_id ?? null,
  };
}
