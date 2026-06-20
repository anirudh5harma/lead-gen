"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type MouseEvent, type ReactNode } from "react";
import { switchWorkspaceAction } from "@/app/dashboard/actions";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import VoiceAssistantDrawer from "@/components/dashboard/VoiceAssistantDrawer";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  matches?: string[];
}

export interface ShellWorkspace {
  id: string;
  name: string;
}

const NAV: NavItem[] = [
  {
    href: "/dashboard/brief",
    label: "Brief",
    icon: "dashboard",
    matches: ["/dashboard/brief", "/dashboard"],
  },
  {
    href: "/dashboard/agent",
    label: "Agent",
    icon: "auto_awesome",
    matches: ["/dashboard/agent"],
  },
  {
    href: "/dashboard/profile",
    label: "Profile",
    icon: "person",
    matches: ["/dashboard/profile"],
  },
];

function isActivePath(pathname: string, href: string, matches?: string[]): boolean {
  const candidates = matches ?? [href];
  return candidates.some(
    (candidate) =>
      pathname === candidate ||
      (candidate !== "/dashboard" && pathname.startsWith(candidate + "/")),
  );
}

function hrefPath(href: string): string {
  const hashIndex = href.indexOf("#");
  return hashIndex >= 0 ? href.slice(0, hashIndex) : href;
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
    ? !isActivePath(pathname, hrefPath(pendingHref))
    : false;
  function handleNavClick(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
    matches?: string[],
  ) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0 ||
      hrefPath(href) === pathname ||
      isActivePath(pathname, href, matches)
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
      {/* Top nav — Ploy pill-rail pattern, floating */}
      <header className="fixed left-0 right-0 top-0 z-50 px-4 pt-4 md:px-6">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-3">
          <Link
            href="/dashboard/brief"
            onClick={(event) =>
              handleNavClick(event, "/dashboard/brief", [
                "/dashboard/brief",
                "/dashboard",
              ])
            }
            className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-ink-0)]/90 px-4 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)] backdrop-blur-md ring-1 ring-[var(--color-line-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Image
              src="/logo.svg"
              alt=""
              width={22}
              height={22}
              priority
              unoptimized
              className="size-[22px]"
            />
            Bombsell
          </Link>

          <nav className="hidden h-12 items-center gap-0.5 rounded-full bg-[var(--color-ink-0)]/90 px-2 text-[13.5px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] backdrop-blur-md ring-1 ring-[var(--color-line-1)] md:inline-flex">
            {NAV.map((item) => {
              const active = isActivePath(pathname, item.href, item.matches);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(event) => handleNavClick(event, item.href, item.matches)}
                  aria-current={active ? "page" : undefined}
                  className={
                    "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 transition-colors " +
                    (active
                      ? "bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]"
                      : "hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
                  }
                >
                  <Icon name={item.icon} size={14} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
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
                  className="h-12 max-w-[180px] rounded-full bg-[var(--color-ink-0)]/90 px-4 text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] outline-none ring-1 ring-[var(--color-line-1)] backdrop-blur-md transition hover:text-[var(--color-text-1)]"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              </form>
            ) : null}
            <VoiceAssistantDrawer />
            <form action="/auth/sign-out" method="post">
              <PendingSubmitButton
                aria-label="Sign out"
                title="Sign out"
                className="grid size-12 place-items-center rounded-full bg-[var(--color-ink-0)]/90 text-[var(--color-text-3)] backdrop-blur-md ring-1 ring-[var(--color-line-1)] transition-colors hover:text-[var(--color-text-1)]"
                pendingLabel=""
              >
                <Icon name="logout" size={16} />
              </PendingSubmitButton>
            </form>
          </div>
        </div>
      </header>

      {/* Mobile sub-nav */}
      <nav className="fixed left-0 right-0 top-[68px] z-40 mx-auto flex w-full max-w-[1280px] gap-1 overflow-x-auto px-4 pb-3 md:hidden">
        <div className="mx-auto inline-flex h-11 items-center gap-0.5 rounded-full bg-[var(--color-ink-0)]/90 px-1.5 text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] backdrop-blur-md ring-1 ring-[var(--color-line-1)]">
          {NAV.map((item) => {
            const active = isActivePath(pathname, item.href, item.matches);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={(event) => handleNavClick(event, item.href, item.matches)}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 transition-colors " +
                  (active
                    ? "bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]"
                    : "hover:text-[var(--color-text-1)]")
                }
              >
                <Icon name={item.icon} size={14} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="relative z-20 mx-auto w-full min-w-0 max-w-[1280px] overflow-x-clip px-4 pb-16 pt-[140px] md:px-8 md:pt-[96px] lg:px-12">
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
    <div className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-6 py-12 text-center">
      <p
        className="text-[17px] font-semibold tracking-[-0.015em] text-[var(--color-text-1)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </p>
      {hint ? (
        <p className="mx-auto mt-2.5 max-w-md text-[13.5px] leading-[1.6] tracking-[-0.01em] text-[var(--color-text-3)]">
          {hint}
        </p>
      ) : null}
      {cta ? (
        <Link href={cta.href} className="btn-solid-sm mt-6 inline-flex">
          {cta.icon ? <Icon name={cta.icon} size={14} /> : null}
          {cta.label}
        </Link>
      ) : null}
    </div>
  );
}
