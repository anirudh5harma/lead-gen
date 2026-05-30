import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/Shell";
import { getRequestUserId } from "@/lib/auth";
import { googleAuthPath } from "@/lib/auth/next";
import { getActiveWorkspace } from "@/lib/workspace";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userId = await getRequestUserId();
  if (!userId) redirect(googleAuthPath("/dashboard"));

  const workspace = await getActiveWorkspace();
  // Read the current pathname so the sidebar can highlight the active nav.
  const h = await headers();
  const current =
    h.get("x-pathname") ??
    h.get("next-url") ??
    "/dashboard";
  return (
    <DashboardShell workspace={workspace} current={current}>
      {children}
    </DashboardShell>
  );
}
