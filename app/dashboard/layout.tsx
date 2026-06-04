import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/Shell";
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

  // Active-nav highlighting is handled client-side via usePathname in the shell.
  return (
    <DashboardShell
      activeWorkspaceId={workspaceId}
      workspaces={workspaces.map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
      }))}
    >
      {children}
    </DashboardShell>
  );
}
