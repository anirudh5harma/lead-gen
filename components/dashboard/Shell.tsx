"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LiveIndicator } from "@/app/brief/live-indicator";
import { switchWorkspaceAction } from "@/app/dashboard/actions";
import Icon from "@/components/Icon";

interface NavItem {
  href: string;
  label: string;
  badge?: keyof DashboardBadges;
}

export interface DashboardBadges {
  approvals: number;
  deliverability: number;
}

export interface ShellWorkspace {
  id: string;
  name: string;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Brief" },
  { href: "/dashboard/conversations", label: "Outreach" },
  { href: "/dashboard/content", label: "Content" },
  { href: "/dashboard/ingestion", label: "Campaigns" },
  { href: "/dashboard/approvals", label: "Review", badge: "approvals" },
  { href: "/dashboard/deliverability", label: "Domains", badge: "deliverability" },
  { href: "/dashboard/reps", label: "Reps" },
  { href: "/dashboard/aeo", label: "AEO" },
  { href: "/dashboard/setup", label: "Profile" },
];

// Brief ("/dashboard") matches only its own page; section links match the
// page and any nested route under it.
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export function DashboardShell({
  children,
  badges = { approvals: 0, deliverability: 0 },
  liveEnabled = true,
  workspaces = [],
  activeWorkspaceId,
}: {
  children: ReactNode;
  badges?: DashboardBadges;
  liveEnabled?: boolean;
  workspaces?: ShellWorkspace[];
  activeWorkspaceId?: string;
}) {
  const pathname = usePathname() ?? "/dashboard";
  const settingsBadge = badges.approvals + badges.deliverability;

  return (
    <div className="canvas-bg relative isolate min-h-[100dvh] text-[var(--color-text-1)]">
      {/* Top frame — translucent full-viewport bar, top + bottom hairlines */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-t border-[color:var(--color-line-2)] bg-[rgba(245,248,251,0.72)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1320px] items-center gap-6 px-6 py-3.5 md:px-10 lg:px-16">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-[1.0625rem] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Image
              src="/logo.svg"
              alt=""
              width={24}
              height={24}
              priority
              unoptimized
              className="size-6"
            />
            Bombsell
          </Link>

          <nav className="ml-2 hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((item) => {
              const active = isActivePath(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "rounded-md px-2.5 py-1.5 text-[13.5px] transition-colors " +
                    (active
                      ? "text-[var(--color-text-1)] bg-[var(--color-ink-2)]"
                      : "text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
                  }
                >
                  <span>{item.label}</span>
                  {item.badge && badges[item.badge] > 0 ? (
                    <span className="ml-1.5 inline-flex min-w-4 justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold leading-4 text-[var(--color-ink-0)]">
                      {badges[item.badge]}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {workspaces.length > 1 ? (
              <form action={switchWorkspaceAction} className="hidden sm:block">
                <label className="sr-only" htmlFor="workspace-switcher">
                  Workspace
                </label>
                <select
                  id="workspace-switcher"
                  name="workspace_id"
                  defaultValue={activeWorkspaceId}
                  onChange={(event) => event.currentTarget.form?.requestSubmit()}
                  className="h-8 max-w-[180px] rounded-md border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] px-2 text-[13px] font-medium text-[var(--color-text-2)] outline-none transition hover:text-[var(--color-text-1)]"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </form>
            ) : null}
            <div className="hidden lg:block">
              <LiveIndicator enabled={liveEnabled} />
            </div>
            <Link
              href="/dashboard/setup"
              aria-label="Workspace settings"
              className="relative grid size-8 place-items-center rounded-md text-[var(--color-text-3)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]"
            >
              <Icon name="settings" size={17} />
              {settingsBadge > 0 ? (
                <span className="absolute right-1 top-1 size-2 rounded-full bg-[var(--color-accent)]" />
              ) : null}
            </Link>
          </div>
        </div>
      </header>

      {/* Viewport-anchored side rules */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-6 top-0 z-10 w-px bg-[color:var(--color-line-2)] md:left-10 lg:left-16"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-6 top-0 z-10 w-px bg-[color:var(--color-line-2)] md:right-10 lg:right-16"
      />

      {/* Mobile sub-nav (visible <md) — wraps the section list under the header */}
      <nav className="fixed left-0 right-0 top-[58px] z-40 mx-auto flex w-full max-w-[1320px] gap-1 overflow-x-auto border-b border-[color:var(--color-line-2)] bg-[rgba(245,248,251,0.72)] px-6 py-2 backdrop-blur-md md:hidden">
        {NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "shrink-0 rounded-md px-2.5 py-1 text-[13px] transition-colors " +
                (active
                  ? "text-[var(--color-text-1)] bg-[var(--color-ink-2)]"
                  : "text-[var(--color-text-2)] hover:text-[var(--color-text-1)]")
              }
            >
              <span>{item.label}</span>
              {item.badge && badges[item.badge] > 0 ? (
                <span className="ml-1.5 inline-flex min-w-4 justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold leading-4 text-[var(--color-ink-0)]">
                  {badges[item.badge]}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <main className="relative z-20 mx-auto w-full max-w-[1320px] px-6 pb-16 pt-[88px] md:px-10 md:pt-[80px] lg:px-16">
        {children}
      </main>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  cta,
}: {
  title: string;
  hint?: string;
  cta?: { href: string; label: string; icon?: string };
}) {
  return (
    <div className="rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] px-6 py-10 text-center">
      <p className="text-[17px] font-semibold text-[var(--color-text-1)]">{title}</p>
      {hint ? (
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-[var(--color-text-3)]">
          {hint}
        </p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
        >
          {cta.icon ? <Icon name={cta.icon} size={16} /> : null}
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
