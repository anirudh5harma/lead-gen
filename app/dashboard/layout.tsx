import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/Toast";
import { DashboardShell } from "@/components/dashboard/Shell";
import ActivationBanner from "@/components/dashboard/ActivationBanner";
import BillingBanner from "@/components/dashboard/BillingBanner";
import { getRequestAuthIdentity } from "@/lib/auth";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import {
  googleAuthPath,
  ONBOARDING_PATH,
  PRODUCT_HOME_PATH,
} from "@/lib/auth/next";
import {
  getActiveWorkspaceSessionForDashboard,
  listWorkspacesForDashboard,
  type ActiveWorkspace,
} from "@/lib/workspace";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getWorkspaceBillingState } from "@/core/billing/index.ts";
import {
  getWorkspaceActivationState,
} from "@/core/product/activation-state.ts";
import { ensureDefaultSignalSourcesForWorkspace } from "@/core/product/self-heal.ts";

type DashboardChromeState =
  | {
      kind: "ready";
      workspaceId: string;
      workspaces: ActiveWorkspace[];
    }
  | { kind: "onboarding" }
  | { kind: "unavailable" };

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const identity = await getRequestAuthIdentity();
  if (!identity) redirect(googleAuthPath(PRODUCT_HOME_PATH));
  const chrome = await loadDashboardChrome(identity);
  if (chrome.kind === "onboarding") redirect(ONBOARDING_PATH);
  if (chrome.kind === "unavailable") {
    return (
      <ToastProvider>
        <DashboardShell workspaces={[]}>
          <DashboardUnavailable />
        </DashboardShell>
      </ToastProvider>
    );
  }

  // Active-nav highlighting is handled client-side via usePathname in the shell.
  return (
    <ToastProvider>
      <DashboardShell
        activeWorkspaceId={chrome.workspaceId}
        workspaces={chrome.workspaces.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
        }))}
        banners={
          <Suspense fallback={null}>
            <DashboardBanners workspaceId={chrome.workspaceId} />
          </Suspense>
        }
      >
        {children}
      </DashboardShell>
    </ToastProvider>
  );
}

async function loadDashboardChrome(
  identity: Awaited<ReturnType<typeof getRequestAuthIdentity>>,
): Promise<DashboardChromeState> {
  if (!identity) return { kind: "unavailable" };
  try {
    const completed = await findCompletedOnboardingForAuthIdentity(identity);
    if (!completed) return { kind: "onboarding" };
    const [active, workspaces] = await Promise.all([
      getActiveWorkspaceSessionForDashboard("layout"),
      listWorkspacesForDashboard("layout"),
    ]);
    const workspaceId = active?.workspace.id ?? completed.workspace_id;
    const pool = getPool();
    // Fire-and-forget self-heal: reseed default signal sources if the
    // workspace has none (activation setup can die mid-run). Idempotent.
    void ensureDefaultSignalSourcesForWorkspace(pool, workspaceId, identity.id);
    return {
      kind: "ready",
      workspaceId,
      workspaces,
    };
  } catch (err) {
    console.error("[dashboard/layout] failed to load dashboard chrome", err);
    return { kind: "unavailable" };
  }
}

async function DashboardBanners({ workspaceId }: { workspaceId: string }) {
  const pool = getPool();
  const [billing, activation] = await Promise.all([
    getWorkspaceBillingState(pool, workspaceId).catch((err) => {
      console.error("[dashboard/layout] failed to load billing state", err);
      return null;
    }),
    getWorkspaceActivationState(pool, workspaceId).catch((err) => {
      console.error("[dashboard/layout] failed to load activation state", err);
      return null;
    }),
  ]);

  return (
    <>
      <BillingBanner billing={billing} />
      <ActivationBanner activation={activation} />
    </>
  );
}

function DashboardUnavailable() {
  return (
    <section className="section-canvas p-6">
      <p className="brief-kicker">Dashboard</p>
      <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
        Dashboard is temporarily unavailable.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-2)]">
        We could not load the workspace just now. Refresh in a moment; your
        Agent work and channel limits stay protected.
      </p>
    </section>
  );
}
