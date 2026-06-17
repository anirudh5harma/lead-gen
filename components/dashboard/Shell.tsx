"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import { switchWorkspaceAction } from "@/app/dashboard/actions";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";

interface NavItem {
  href: string;
  label: string;
}

export interface ShellWorkspace {
  id: string;
  name: string;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Brief" },
  { href: "/dashboard/prospecting", label: "Prospecting" },
  { href: "/dashboard/signals", label: "Signals" },
  { href: "/dashboard/conversations", label: "Outreach" },
  { href: "/dashboard/campaigns", label: "Campaigns" },
];

// Brief ("/dashboard") matches only its own page; section links match the
// page and any nested route under it.
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export function DashboardShell({
  children,
  workspaces = [],
  activeWorkspaceId,
}: {
  children: ReactNode;
  workspaces?: ShellWorkspace[];
  activeWorkspaceId?: string;
}) {
  const pathname = usePathname() ?? "/dashboard";
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const routePending = pendingHref
    ? !isActivePath(pathname, pendingHref)
    : false;
  const settingsActive = isActivePath(pathname, "/dashboard/settings");

  function handleNavClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      isActivePath(pathname, href)
    ) {
      return;
    }
    setPendingHref(href);
  }

  return (
    <div className="canvas-bg relative isolate min-h-[100dvh] overflow-x-clip text-[var(--color-text-1)]">
      {routePending ? (
        <div className="dashboard-route-pending" aria-hidden="true" />
      ) : null}
      {/* Top product frame */}
      <header className="glass-nav fixed left-0 right-0 top-0 z-50">
        <div className="mx-auto flex w-full max-w-[1200px] items-center gap-6 px-6 py-3.5 md:px-10 lg:px-16">
          <Link
            href="/dashboard"
            onClick={(event) => handleNavClick(event, "/dashboard")}
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
                  onClick={(event) => handleNavClick(event, item.href)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "rounded-[8px] px-2.5 py-1.5 text-[13.5px] transition-colors " +
                    (active
                      ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-2)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
                  }
                >
                  <span>{item.label}</span>
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
                  onChange={(event) =>
                    event.currentTarget.form?.requestSubmit()
                  }
                  className="h-8 max-w-[180px] rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-2 text-[13px] font-medium text-[var(--color-text-2)] outline-none transition hover:border-[var(--color-line-3)] hover:text-[var(--color-text-1)]"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </form>
            ) : null}
            <Link
              href="/dashboard/settings"
              aria-label="Settings"
              title="Settings"
              onClick={(event) => handleNavClick(event, "/dashboard/settings")}
              aria-current={settingsActive ? "page" : undefined}
              className={
                "relative grid size-8 place-items-center rounded-[8px] transition-colors " +
                (settingsActive
                  ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-3)] hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
              }
            >
              <Icon name="settings" size={17} />
            </Link>
            <form action="/auth/sign-out" method="post">
              <PendingSubmitButton
                aria-label="Sign out"
                title="Sign out"
                className="relative grid size-8 place-items-center rounded-[8px] text-[var(--color-text-3)] transition-colors hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]"
                pendingLabel=""
              >
                <Icon name="logout" size={17} />
              </PendingSubmitButton>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile sub-nav (visible <md) */}
      <nav className="glass-nav fixed left-0 right-0 top-[58px] z-40 mx-auto flex w-full max-w-[1200px] gap-1 overflow-x-auto border-b border-[color:var(--color-line-1)] bg-[var(--color-ink-0)]/80 px-6 py-2 backdrop-blur-md md:hidden">
        {NAV.map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => handleNavClick(event, item.href)}
              aria-current={active ? "page" : undefined}
              className={
                "shrink-0 rounded-[8px] px-2.5 py-1 text-[13px] transition-colors " +
                (active
                  ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-2)] hover:text-[var(--color-text-1)]")
              }
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <main className="relative z-20 mx-auto w-full min-w-0 max-w-[1200px] overflow-x-clip px-6 pb-16 pt-[108px] md:px-10 md:pt-[80px] lg:px-16">
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
    <div className="rounded-[10px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] px-6 py-10 text-center">
      <p className="text-[17px] font-semibold text-[var(--color-text-1)]">
        {title}
      </p>
      {hint ? (
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-[var(--color-text-3)]">
          {hint}
        </p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="btn-solid mt-5 inline-flex"
        >
          {cta.icon ? <Icon name={cta.icon} size={16} /> : null}
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
