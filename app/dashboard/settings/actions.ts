"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateIcpText } from "@/core/product/app";
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

  await updateIcpText(
    { name, description },
    { workspace_id: session.workspace.id, user_id: session.user_id },
  );

  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings");
}
