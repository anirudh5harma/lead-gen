import type { Pool } from "pg";

export interface WorkspaceActivationState {
  website_set: boolean;
  description_set: boolean;
  product_ready: boolean;
}

interface ActivationStateRow {
  website_url: string | null;
  description: string | null;
}

export async function getWorkspaceActivationState(
  pool: Pool,
  workspace_id: string,
): Promise<WorkspaceActivationState> {
  const { rows } = await pool.query<ActivationStateRow>(
    `select
        nullif(btrim(properties->>'website_url'), '') as website_url,
        nullif(btrim(description), '') as description
       from graph_companies
      where workspace_id = $1
        and properties->>'profile_role' = 'workspace_company'
      order by updated_at desc, created_at desc
      limit 1`,
    [workspace_id],
  );
  const website_set = Boolean(rows[0]?.website_url);
  const description_set = Boolean(rows[0]?.description);
  return {
    website_set,
    description_set,
    product_ready: website_set && description_set,
  };
}
