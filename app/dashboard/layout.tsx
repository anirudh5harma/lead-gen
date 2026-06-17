import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/Toast";
import {
  DashboardShell,
  type ProductFlowMetrics,
} from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getRequestAuthIdentity } from "@/lib/auth";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import { googleAuthPath, ONBOARDING_PATH } from "@/lib/auth/next";
import { getActiveWorkspaceSession, listWorkspaces } from "@/lib/workspace";

const EMPTY_FLOW_METRICS: ProductFlowMetrics = {
  profile: { value: "Connect", tone: "waiting" },
  sources: { value: "Add sources", tone: "waiting" },
  signals: { value: "0 qualified", tone: "neutral" },
  outreach: { value: "0 sent 7d", tone: "neutral" },
};

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
  const flowMetrics = await loadProductFlowMetrics(workspaceId);

  // Active-nav highlighting is handled client-side via usePathname in the shell.
  return (
    <ToastProvider>
      <DashboardShell
        activeWorkspaceId={workspaceId}
        flowMetrics={flowMetrics}
        workspaces={workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
        }))}
      >
        {children}
      </DashboardShell>
    </ToastProvider>
  );
}

async function loadProductFlowMetrics(
  workspaceId: string,
): Promise<ProductFlowMetrics> {
  try {
    const pool = getPool();
    const { rows } = await pool.query<{
      workspace_profiles: string;
      connected_accounts: string;
      active_sources: string;
      qualified_signals_7d: string;
      outreach_sent_7d: string;
    }>(
      `select
         (select count(*)::text
            from graph_companies gc
           where gc.workspace_id = $1
             and gc.properties->>'profile_role' = 'workspace_company') as workspace_profiles,
         (select count(*)::text
            from channel_accounts ca
           where ca.workspace_id = $1
             and ca.kind::text in ('email_oauth','oauth_outlook','linkedin_session','linkedin_oauth')
             and ca.status::text = 'connected') as connected_accounts,
         (select count(*)::text
            from workspace_source_configs wsc
            join graph_sources gs
              on gs.id = wsc.source_id
             and gs.workspace_id = wsc.workspace_id
           where wsc.workspace_id = $1
             and wsc.enabled
             and gs.enabled) as active_sources,
         (select count(*)::text
            from signals s
           where s.workspace_id = $1
             and s.status in ('matched','in_play')
             and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as qualified_signals_7d,
         (select count(*)::text
            from messages m
           where m.workspace_id = $1
             and m.direction = 'outbound'
             and m.channel in (
               'email',
               'linkedin_dm',
               'linkedin_inmail',
               'linkedin_connection',
               'linkedin_comment'
             )
             and m.status in ('sent','delivered','replied')
             and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as outreach_sent_7d`,
      [workspaceId],
    );
    const row = rows[0];
    if (!row) return EMPTY_FLOW_METRICS;

    const workspaceProfiles = Number(row.workspace_profiles ?? 0);
    const connectedAccounts = Number(row.connected_accounts ?? 0);
    const activeSources = Number(row.active_sources ?? 0);
    const qualifiedSignals = Number(row.qualified_signals_7d ?? 0);
    const outreachSent = Number(row.outreach_sent_7d ?? 0);

    return {
      profile: {
        value:
          connectedAccounts > 0
            ? `${connectedAccounts} connected`
            : workspaceProfiles > 0
              ? "Connect"
              : "Add profile",
        tone:
          connectedAccounts > 0
            ? "ready"
            : workspaceProfiles > 0
              ? "waiting"
              : "neutral",
      },
      sources: {
        value: activeSources > 0 ? `${activeSources} active` : "Add sources",
        tone: activeSources > 0 ? "ready" : "waiting",
      },
      signals: {
        value: `${qualifiedSignals} qualified`,
        tone: qualifiedSignals > 0 ? "ready" : "neutral",
      },
      outreach: {
        value: `${outreachSent} sent 7d`,
        tone: outreachSent > 0 ? "ready" : "neutral",
      },
    };
  } catch (err) {
    console.error("[dashboard/layout] failed to load product flow metrics", err);
    return EMPTY_FLOW_METRICS;
  }
}
