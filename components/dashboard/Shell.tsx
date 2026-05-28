import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import type { ActiveWorkspace } from "@/lib/workspace";

/**
 * Dashboard chrome. Sidebar with the five primitives + the morning brief.
 * Top bar shows the active workspace (no switcher UI yet — the cookie is
 * the seam for production auth integration).
 *
 * Server component: no client state, no interactivity beyond hyperlinks.
 * Interactive bits (approve / reject buttons) live in the views that need
 * them as small server actions.
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Morning brief", icon: "wb_twilight" },
  { href: "/dashboard/conversations", label: "Conversations", icon: "forum" },
  { href: "/dashboard/approvals", label: "Approvals", icon: "rule" },
  { href: "/dashboard/reps", label: "Reps", icon: "smart_toy" },
  { href: "/dashboard/plays", label: "Plays", icon: "playlist_play" },
  { href: "/dashboard/ingestion", label: "Ingestion", icon: "sensors" },
  { href: "/dashboard/deliverability", label: "Deliverability", icon: "mark_email_read" },
  { href: "/dashboard/ops", label: "Ops", icon: "monitor_heart" },
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
    <div className="min-h-screen flex bg-[var(--color-ink-1)] text-[var(--color-text-1)]">
      <aside className="w-60 shrink-0 border-r border-[var(--color-line-1)] flex flex-col">
        <div className="px-5 py-5 border-b border-[var(--color-line-1)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
            workspace
          </p>
          <p className="font-serif text-lg text-[var(--color-text-1)] leading-tight mt-1">
            {workspace?.name ?? "No workspace"}
          </p>
          {workspace ? (
            <p className="font-mono text-[10px] text-[var(--color-text-4)] mt-0.5">
              {workspace.slug}
            </p>
          ) : null}
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {NAV.map((item) => {
            const active =
              current === item.href ||
              (item.href !== "/dashboard" && current.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  "flex items-center gap-3 px-3 py-2 rounded-md font-sans text-sm " +
                  (active
                    ? "bg-[var(--color-ink-3)] text-[var(--color-text-1)]"
                    : "text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
                }
              >
                <Icon name={item.icon} className="text-[18px]" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 border-t border-[var(--color-line-1)]">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)] mb-1">
            pivot-v2 · foundation
          </p>
          <p className="font-mono text-[10px] text-[var(--color-text-4)] leading-snug">
            See ARCHITECTURE.md for the model.
          </p>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mb-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-text-3)]">
        {eyebrow}
      </p>
      <h1 className="font-serif text-3xl text-[var(--color-text-1)] mt-1 leading-tight">
        {title}
      </h1>
      {subtitle ? (
        <p className="font-sans text-[var(--color-text-2)] mt-2">{subtitle}</p>
      ) : null}
    </header>
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
    <div className="border border-dashed border-[var(--color-line-2)] rounded-lg px-6 py-12 text-center">
      <p className="font-serif text-xl text-[var(--color-text-1)]">{title}</p>
      {hint ? (
        <p className="font-sans text-sm text-[var(--color-text-3)] mt-2">{hint}</p>
      ) : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
        {label}
      </p>
      <p className="font-serif text-3xl text-[var(--color-text-1)] mt-1">
        {value}
      </p>
      {hint ? (
        <p className="font-sans text-xs text-[var(--color-text-3)] mt-1">{hint}</p>
      ) : null}
    </div>
  );
}
