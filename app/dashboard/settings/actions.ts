"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";

/**
 * Lightweight name+description update on the workspace's primary ICP.
 * Preserves signal_kind + must_haves + match_threshold. Advanced tuning
 * still lives in the Agent surface.
 */
export async function updateIcpTextAction(formData: FormData) {
  const session = await getActiveWorkspaceSessionForDashboard("settings/icp");
  if (!session) redirect("/dashboard/settings");

  const name = String(formData.get("icp_name") ?? "").trim();
  const description = String(formData.get("icp_description") ?? "").trim();
  if (!name && !description) redirect("/dashboard/settings");

  const pool = getPool();
  const { rows } = await pool.query<{ id: string }>(
    `select id from workspace_icps
      where workspace_id = $1
      order by created_at asc
      limit 1`,
    [session.workspace.id],
  );
  const icpId = rows[0]?.id;
  if (!icpId) redirect("/dashboard/settings");

  await pool.query(
    `update workspace_icps
        set name = coalesce(nullif($2, ''), name),
            description = coalesce(nullif($3, ''), description),
            updated_at = now()
      where workspace_id = $1
        and id = $4`,
    [session.workspace.id, name, description, icpId],
  );

  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}
