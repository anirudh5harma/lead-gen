import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/Shell";
import { getRequestUserId } from "@/lib/auth";
import { googleAuthPath } from "@/lib/auth/next";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userId = await getRequestUserId();
  if (!userId) redirect(googleAuthPath("/dashboard"));

  // Active-nav highlighting is handled client-side via usePathname in the shell.
  return <DashboardShell>{children}</DashboardShell>;
}
