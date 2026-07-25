"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  setWorkspaceAutonomyModeAction,
  switchWorkspaceAction,
} from "@/app/dashboard/actions";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { useToast } from "@/components/Toast";
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

export type WorkspaceAutonomyMode = "autonomous" | "review_only";

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
  autonomyMode = "autonomous",
  banners,
}: {
  children: ReactNode;
  workspaces?: ShellWorkspace[];
  activeWorkspaceId?: string;
  autonomyMode?: WorkspaceAutonomyMode;
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

      <div className="fixed right-6 top-5 z-40 hidden items-center gap-2 md:flex">
        <WorkspaceModeSwitch
          key={`desktop:${activeWorkspaceId ?? "workspace"}:${autonomyMode}`}
          mode={autonomyMode}
        />
        <SignOutButton />
      </div>

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
        <div className="flex items-center gap-1.5">
          <WorkspaceModeSwitch
            key={`mobile:${activeWorkspaceId ?? "workspace"}:${autonomyMode}`}
            mode={autonomyMode}
            compact
          />
          <SignOutButton compact />
        </div>
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

function WorkspaceModeSwitch({
  mode,
  compact = false,
}: {
  mode: WorkspaceAutonomyMode;
  compact?: boolean;
}) {
  const [selectedMode, setSelectedMode] = useState(mode);
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  function selectMode(nextMode: WorkspaceAutonomyMode) {
    if (isPending || nextMode === selectedMode) return;
    const previousMode = selectedMode;
    setSelectedMode(nextMode);
    startTransition(async () => {
      try {
        const result = await setWorkspaceAutonomyModeAction(nextMode);
        if (!result.ok) {
          setSelectedMode(previousMode);
          toast.error(result.error);
          return;
        }
        toast.success(
          result.mode === "autonomous"
            ? "Auto mode is on. Outreach can send after checks."
            : "Review mode is on. Outreach will wait for approval.",
        );
      } catch {
        setSelectedMode(previousMode);
        toast.error("Could not change outreach mode. Try again.");
      }
    });
  }

  return (
    <div
      role="group"
      aria-label="Outreach operating mode"
      aria-busy={isPending}
      className={
        "relative grid grid-cols-2 rounded-[10px] bg-[var(--color-ink-2)] p-1 ring-1 ring-[var(--color-line-1)] " +
        (compact ? "w-[116px]" : "w-[148px]")
      }
    >
      <span
        aria-hidden="true"
        className={
          "pointer-events-none absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] transform-gpu rounded-[7px] bg-[var(--color-cta-bg)] shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none " +
          (selectedMode === "review_only" ? "translate-x-full" : "translate-x-0")
        }
      />
      <ModeOption
        value="autonomous"
        label="Auto"
        active={selectedMode === "autonomous"}
        disabled={isPending}
        onSelect={selectMode}
        compact={compact}
        title="Auto: send outreach after quality and channel checks pass"
      />
      <ModeOption
        value="review_only"
        label="Review"
        active={selectedMode === "review_only"}
        disabled={isPending}
        onSelect={selectMode}
        compact={compact}
        title="Review: hold judged drafts for approval before sending"
      />
      <span className="sr-only" aria-live="polite">
        {isPending
          ? `Switching to ${selectedMode === "autonomous" ? "Auto" : "Review"} mode`
          : `${selectedMode === "autonomous" ? "Auto" : "Review"} mode active`}
      </span>
    </div>
  );
}

function ModeOption({
  value,
  label,
  active,
  disabled,
  onSelect,
  compact,
  title,
}: {
  value: WorkspaceAutonomyMode;
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: (mode: WorkspaceAutonomyMode) => void;
  compact: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onSelect(value)}
      className={
        "relative z-10 h-8 rounded-[7px] font-medium outline-none transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-ink-2)] motion-reduce:transition-none disabled:cursor-wait " +
        (compact ? "px-2 text-[11px] " : "px-3 text-xs ") +
        (active
          ? "text-[var(--color-cta-text)]"
          : "text-[var(--color-text-3)] hover:text-[var(--color-text-1)]")
      }
    >
      {label}
    </button>
  );
}

function SignOutButton({ compact = false }: { compact?: boolean }) {
  return (
    <form action="/auth/sign-out" method="post">
      <PendingSubmitButton
        aria-label="Sign out"
        title="Sign out securely"
        className={
          "inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[var(--color-ink-0)] font-medium text-[var(--color-text-2)] ring-1 ring-[var(--color-line-1)] transition-all hover:bg-[var(--color-ink-2)] hover:text-[var(--color-text-1)] " +
          (compact ? "size-9 px-0" : "px-3 text-xs")
        }
        pendingLabel={compact ? "" : "Signing out"}
      >
        <Icon name="logout" size={14} />
        {compact ? null : <span>Sign out</span>}
      </PendingSubmitButton>
    </form>
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
