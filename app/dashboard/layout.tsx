import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardShell, type DashboardBadges } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getRequestAuthIdentity } from "@/lib/auth";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import { googleAuthPath, ONBOARDING_PATH } from "@/lib/auth/next";
import { getActiveWorkspaceSession, listWorkspaces } from "@/lib/workspace";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const identity = await getRequestAuthIdentity();
  if (!identity) redirect(googleAuthPath("/dashboard"));
  const completed = await findCompletedOnboardingForAuthIdentity(identity);
  if (!completed) redirect(ONBOARDING_PATH);
  const [active, workspaces] = await Promise.all([
    getActiveWorkspaceSession(),
    listWorkspaces(),
  ]);
  const workspaceId = active?.workspace.id ?? completed.workspace_id;
  const badges = await loadDashboardBadges(workspaceId);

  // Active-nav highlighting is handled client-side via usePathname in the shell.
  return (
    <DashboardShell
      activeWorkspaceId={workspaceId}
      badges={badges}
      liveEnabled={Boolean(workspaceId)}
      workspaces={workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
      }))}
    >
      {children}
    </DashboardShell>
  );
}

async function loadDashboardBadges(workspaceId: string): Promise<DashboardBadges> {
  const pool = getPool();
  const { rows } = await pool.query<{ approvals: string; deliverability: string }>(
    `select
       (select count(*)::text
          from workflow_approvals
         where workspace_id = $1 and decision = 'pending') as approvals,
       (
         (select count(*) from sending_domains
            where workspace_id = $1
              and (spf_verified = false or dkim_verified = false or dmarc_verified = false
                   or warmup_state in ('degraded','frozen'))) +
         (select count(*) from messages
            where workspace_id = $1
              and status in ('bounced','failed')
              and created_at >= now() - interval '24 hours')
       )::text as deliverability`,
    [workspaceId],
  );
  return {
    approvals: Number(rows[0]?.approvals ?? 0),
    deliverability: Number(rows[0]?.deliverability ?? 0),
  };
}
