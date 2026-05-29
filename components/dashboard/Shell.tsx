import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import type { ActiveWorkspace } from "@/lib/workspace";

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Brief", icon: "auto_stories" },
  { href: "/dashboard/conversations", label: "Outreach", icon: "mark_email_read" },
  { href: "/dashboard/plays", label: "Content", icon: "edit_square" },
  { href: "/dashboard/ingestion", label: "Campaigns", icon: "conversion_path" },
  { href: "/dashboard/ops", label: "AEO", icon: "travel_explore" },
  { href: "/dashboard/setup", label: "Profile", icon: "id_card" },
];

export function DashboardShell({
  workspace,
  current,
  children,
}: {
  workspace: ActiveWorkspace | null;
  current: string;
  children: ReactNode;
}) {
  return (
    <div className="canvas-bg min-h-screen text-[var(--color-text-1)]">
      <div className="app-canvas-shell">
        <aside className="workspace-sidebar">
          <div className="flex items-center gap-2 px-4 py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-text-1)] font-mono text-xs font-semibold text-[var(--color-ink-0)]">
              B
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
                {workspace?.name ?? "No workspace"}
              </span>
              {workspace ? (
                <span className="mt-0.5 block truncate text-xs text-[var(--color-text-3)]">
                  {workspace.slug}
                </span>
              ) : null}
            </span>
          </div>

          <nav className="grid grid-cols-3 gap-1 px-2 pb-2 sm:grid-cols-6 lg:block lg:px-3">
            {NAV.map((item) => {
              const active =
                current === item.href ||
                (item.href !== "/dashboard" && current.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "workspace-row min-h-11 flex-col justify-center text-[11px] transition-colors hover:bg-[var(--color-ink-0)] sm:text-xs lg:min-h-9 lg:flex-row lg:justify-start lg:text-sm " +
                    (active ? "workspace-row-active" : "")
                  }
                >
                  <Icon
                    name={item.icon}
                    className={
                      "text-[18px] " +
                      (active
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-text-3)]")
                    }
                  />
                  <span className="whitespace-nowrap leading-none">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="hidden px-3 pb-3 lg:block">
            <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)] p-3">
              <p className="text-xs font-semibold text-[var(--color-text-1)]">
                Brief rhythm
              </p>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
                Set intent, connect channels, review only the work that needs you.
              </p>
            </div>
          </div>
        </aside>

        <main className="workspace-main">
          <div className="workspace-main-inner">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="section-note px-6 py-10 text-center">
      <p className="text-xl font-semibold text-[var(--color-text-1)]">{title}</p>
      {hint ? (
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--color-text-3)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
