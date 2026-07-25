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
    href: "/dashboard/outreach",
    label: "Outreach",
    icon: "send",
    matches: ["/dashboard/outreach", "/dashboard"],
  },
  {
    href: "/dashboard/conversations",
    label: "Conversations",
    icon: "forum",
    matches: ["/dashboard/conversations"],
  },
  {
    href: "/dashboard/reddit",
    label: "Reddit marketing",
    icon: "campaign",
    matches: ["/dashboard/reddit"],
  },
  {
    href: "/dashboard/integrations",
    label: "Integrations",
    icon: "hub",
    matches: ["/dashboard/integrations"],
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: "settings",
    matches: ["/dashboard/settings"],
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
  banners,
}: {
  children: ReactNode;
  workspaces?: ShellWorkspace[];
  activeWorkspaceId?: string;
  banners?: ReactNode;
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
    <div className="canvas-bg relative isolate min-h-[100dvh] text-[var(--color-text-1)]">
      {routePending ? (
        <div className="dashboard-route-pending" aria-hidden="true" />
      ) : null}

      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-[100dvh] w-[240px] flex-col border-r border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-5 md:flex">
        <Link
          href="/dashboard/outreach"
          onClick={(event) =>
            handleNavClick(event, "/dashboard/outreach", [
              "/dashboard/outreach",
              "/dashboard",
            ])
          }
          className="inline-flex items-center gap-2 px-2 pb-2 text-[16px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]"
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

        {workspaces.length > 1 ? (
          <form action={switchWorkspaceAction} className="mt-4 px-1">
            <label className="sr-only" htmlFor="workspace-switcher">
              Workspace
            </label>
            <select
              id="workspace-switcher"
              name="workspace_id"
              defaultValue={activeWorkspaceId}
              onChange={(event) => event.currentTarget.form?.requestSubmit()}
              className="w-full rounded-[10px] bg-[var(--color-ink-2)] px-3 py-2 text-[13px] font-medium tracking-[-0.01em] text-[var(--color-text-2)] outline-none ring-1 ring-[var(--color-line-1)] transition hover:text-[var(--color-text-1)]"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </form>
        ) : null}

        <nav className="mt-6 flex flex-col gap-0.5 text-[14px] font-medium tracking-[-0.01em] text-[var(--color-text-2)]">
          {NAV.map((item) => {
            const active = isActivePath(pathname, item.href, item.matches);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onClick={(event) => handleNavClick(event, item.href, item.matches)}
                aria-current={active ? "page" : undefined}
                className={
                  "inline-flex h-10 items-center gap-2.5 rounded-[10px] px-3 transition-colors " +
                  (active
                    ? "bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]"
                    : "hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)]")
                }
              >
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-[var(--color-line-1)] pt-4">
          <VoiceAssistantDrawer />
        </div>
      </aside>

      <form
        action="/auth/sign-out"
        method="post"
        className="fixed right-6 top-5 z-40 hidden md:block"
      >
        <PendingSubmitButton
          aria-label="Sign out"
          title="Sign out"
          className="grid size-10 place-items-center rounded-[10px] bg-[var(--color-ink-2)] text-[var(--color-text-3)] ring-1 ring-[var(--color-line-1)] transition-colors hover:text-[var(--color-text-1)]"
          pendingLabel=""
        >
          <Icon name="logout" size={15} />
        </PendingSubmitButton>
      </form>

      {/* Mobile top-bar + drawer */}
      <header className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-[var(--color-line-1)] bg-[var(--color-ink-0)]/95 px-4 backdrop-blur-md md:hidden">
        <Link
          href="/dashboard/outreach"
          onClick={(event) =>
            handleNavClick(event, "/dashboard/outreach", [
              "/dashboard/outreach",
              "/dashboard",
            ])
          }
          className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.02em] text-[var(--color-text-1)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          <Image
            src="/logo.svg"
            alt=""
            width={20}
            height={20}
            priority
            unoptimized
            className="size-5"
          />
          Bombsell
        </Link>
        <form action="/auth/sign-out" method="post">
          <PendingSubmitButton
            aria-label="Sign out"
            title="Sign out"
            className="grid size-9 place-items-center rounded-full bg-[var(--color-ink-2)] text-[var(--color-text-3)] transition-colors hover:text-[var(--color-text-1)]"
            pendingLabel=""
          >
            <Icon name="logout" size={14} />
          </PendingSubmitButton>
        </form>
      </header>

      {/* Mobile sub-nav (horizontal scroll) */}
      <nav className="fixed left-0 right-0 top-14 z-30 flex gap-1 overflow-x-auto border-b border-[var(--color-line-1)] bg-[var(--color-ink-0)]/95 px-3 py-2 backdrop-blur-md md:hidden">
        {NAV.map((item) => {
          const active = isActivePath(pathname, item.href, item.matches);
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              onClick={(event) => handleNavClick(event, item.href, item.matches)}
              aria-current={active ? "page" : undefined}
              className={
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium tracking-[-0.01em] transition-colors " +
                (active
                  ? "bg-[var(--color-cta-bg)] text-[var(--color-cta-text)]"
                  : "text-[var(--color-text-2)] hover:text-[var(--color-text-1)]")
              }
            >
              <Icon name={item.icon} size={13} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <main
        className="relative z-20 mx-auto w-full min-w-0 max-w-[1200px] px-4 pb-16 pt-[124px] md:ml-[240px] md:w-[calc(100%-240px)] md:max-w-none md:px-8 md:pt-8 lg:px-12"
        aria-busy={routePending}
      >
        {banners}
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
