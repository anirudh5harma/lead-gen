import Link from "next/link";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import {
  getProductCompanyProfile,
  verifiedProductWorkspaceSession,
  type ProductCompanyProfile,
} from "@/core/product/app";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import {
  createWorkspaceAction,
  editCompanyProfileAction,
  updateWorkspaceAutonomyAction,
} from "../actions";

export const dynamic = "force-dynamic";

type SettingsAutonomyMode = "autonomous" | "review_only" | "custom";

interface SettingsOutlookAccount {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
  properties: Record<string, unknown> | null;
  updated_at: Date;
}

interface SettingsState {
  settings: Record<string, unknown>;
  outlookAccount: SettingsOutlookAccount | null;
  approvals: string[];
}

async function loadSettingsState(workspaceId: string): Promise<SettingsState> {
  const pool = getPool();
  const [workspace, outlook, policies] = await Promise.all([
    pool.query<{ settings: Record<string, unknown> }>(
      `select settings
         from workspaces
        where id = $1`,
      [workspaceId],
    ),
    pool.query<SettingsOutlookAccount>(
      `with ranked_accounts as (
         select id,
                display_name,
                status::text as status,
                daily_cap,
                last_error,
                properties,
                updated_at,
                row_number() over (
                  partition by 'outlook:' || coalesce(
                    nullif(lower(properties ->> 'mailbox_email'), ''),
                    nullif(lower(display_name), ''),
                    id::text
                  )
                  order by case
                             when status = 'connected' then 0
                             when status = 'needs_reauth' then 1
                             else 2
                           end,
                           case
                             when properties -> 'outlook_subscription' is not null
                               and properties -> 'outlook_subscription' ->> 'clientState' is not null
                             then 0
                             else 1
                           end,
                           updated_at desc,
                           created_at desc
                ) as account_rank
           from channel_accounts
          where workspace_id = $1
            and kind = 'oauth_outlook'
       )
       select id, display_name, status, daily_cap, last_error, properties, updated_at
         from ranked_accounts
        where account_rank = 1
        order by updated_at desc
        limit 1`,
      [workspaceId],
    ),
    pool.query<{ autonomy: Record<string, unknown> | null }>(
      `select autonomy
         from reps
        where workspace_id = $1
          and status <> 'retired'
       union all
       select autonomy
         from plays
        where workspace_id = $1
          and status in ('draft', 'active', 'paused', 'archived')`,
      [workspaceId],
    ),
  ]);
  return {
    settings: workspace.rows[0]?.settings ?? {},
    outlookAccount: outlook.rows[0] ?? null,
    approvals: policies.rows.flatMap((row) =>
      approvalsFromAutonomy(row.autonomy),
    ),
  };
}

export default async function SettingsPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceSettings />;

  const pool = getPool();
  const productSession = verifiedProductWorkspaceSession({
    workspace_id: active.workspace.id,
    user_id: active.user_id,
  });
  const [profile, state] = await Promise.all([
    getProductCompanyProfile(pool, productSession),
    loadSettingsState(active.workspace.id),
  ]);
  const mode = settingsMode(state.settings, state.approvals);
  const formMode = mode === "review_only" ? "review_only" : "autonomous";
  const outlookLabel = state.outlookAccount
    ? outlookMailbox(state.outlookAccount)
    : "Not connected";

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Settings"
        title={
          <>
            Workspace <em>controls</em>.
          </>
        }
        description="Profile context, connected inbox, and the review posture for outbound Plays."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat
              label="Profile"
              value={profile?.company_name ?? "Needed"}
            />
            <HeroStat label="Outlook" value={outlookLabel} />
            <HeroStat label="Mode" value={modeLabel(mode)} />
          </div>
        }
      />

      <SurfaceSection title="Profile">
        <ProfileSettingsForm profile={profile} />
      </SurfaceSection>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <SurfaceSection title="Connected Outlook">
          <OutlookPanel account={state.outlookAccount} />
        </SurfaceSection>

        <SurfaceSection title="Autonomy">
          <form
            action={updateWorkspaceAutonomyAction}
            className="section-note grid gap-5"
          >
            <input type="hidden" name="return_to" value="/dashboard/settings" />
            <div className="grid gap-3 sm:grid-cols-2">
              <AutonomyOption
                value="autonomous"
                title="Autonomous"
                description="Move after evals, caps, and channel checks pass."
                defaultChecked={formMode === "autonomous"}
              />
              <AutonomyOption
                value="review_only"
                title="Review-only"
                description="Hold outbound moves for human review every time."
                defaultChecked={formMode === "review_only"}
              />
            </div>
            {mode === "custom" ? (
              <p className="text-sm text-[var(--color-text-3)]">
                Current Rep and Play policies are mixed. Saving here applies one
                mode across the workspace.
              </p>
            ) : null}
            <PendingSubmitButton
              className="btn-solid w-fit"
              icon="check"
              pendingLabel="Saving mode"
            >
              Save mode
            </PendingSubmitButton>
          </form>
        </SurfaceSection>
      </section>
    </div>
  );
}

function ProfileSettingsForm({
  profile,
}: {
  profile: ProductCompanyProfile | null;
}) {
  const website = profileWebsite(profile);
  const profileReady = Boolean(profile?.company_name && website);
  return (
    <form action={editCompanyProfileAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/settings" />
      {profileReady ? (
        <>
          <input
            type="hidden"
            name="company_name"
            value={profile!.company_name}
          />
          <input type="hidden" name="website_url" value={website} />
          <input
            type="hidden"
            name="industry"
            value={profile?.industry ?? ""}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <ProfileFact label="Company" value={profile!.company_name} />
            <ProfileFact label="Website" value={website} />
            <ProfileFact
              label="Industry"
              value={profile?.industry ?? "Unspecified"}
            />
          </div>
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            name="company_name"
            label="Company"
            defaultValue={profile?.company_name ?? ""}
            required
          />
          <Field
            name="website_url"
            label="Website"
            defaultValue={website}
            required
          />
          <Field
            name="industry"
            label="Industry"
            defaultValue={profile?.industry ?? ""}
          />
        </div>
      )}
      <TextArea
        name="description"
        label="Company description"
        defaultValue={profile?.description ?? ""}
        rows={5}
      />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="save"
        pendingLabel="Saving profile"
      >
        Save profile
      </PendingSubmitButton>
    </form>
  );
}

function OutlookPanel({ account }: { account: SettingsOutlookAccount | null }) {
  return (
    <div className="section-note grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon
            name={account?.status === "connected" ? "mail" : "sync_problem"}
            size={18}
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {account ? outlookMailbox(account) : "Outlook inbox"}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            {account
              ? `${statusLabel(account.status)} - ${account.daily_cap ?? "unlimited"} daily ceiling`
              : "Connect Microsoft 365 for native send, threading, and reply sync."}
          </p>
          {account?.last_error ? (
            <p className="mt-2 text-sm text-[#ffb4a8]">{account.last_error}</p>
          ) : null}
        </div>
      </div>
      <Link
        href="/api/auth/outlook"
        prefetch={false}
        className="btn-solid w-fit"
      >
        <Icon name="mail" size={16} />
        {account ? "Reconnect Outlook" : "Connect Outlook"}
      </Link>
    </div>
  );
}

function AutonomyOption({
  value,
  title,
  description,
  defaultChecked,
}: {
  value: "autonomous" | "review_only";
  title: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="relative flex cursor-pointer gap-3 rounded-[8px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)]">
      <input
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        type="radio"
        name="autonomy_mode"
        value={value}
        defaultChecked={defaultChecked}
      />
      <span className="grid gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </span>
        <span className="text-sm leading-6 text-[var(--color-text-3)]">
          {description}
        </span>
      </span>
    </label>
  );
}

function ProfileFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-4)]">
        {label}
      </p>
      <p className="mt-1 min-w-0 truncate text-sm text-[var(--color-text-1)]">
        {value}
      </p>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required,
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
      />
    </label>
  );
}

function TextArea({
  name,
  label,
  defaultValue,
  rows,
}: {
  name: string;
  label: string;
  defaultValue: string;
  rows: number;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">
        {label}
      </span>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        className="rounded-[8px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
      />
    </label>
  );
}

function NoWorkspaceSettings() {
  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Settings"
        title="Create a workspace."
        description="Settings attach to the active workspace."
      />
      <SurfaceSection title="Workspace">
        <form
          action={createWorkspaceAction}
          className="section-note grid gap-4 md:max-w-xl"
        >
          <input type="hidden" name="return_to" value="/dashboard/settings" />
          <Field
            name="workspace_name"
            label="Workspace name"
            defaultValue="Bombsell Workspace"
          />
          <Field
            name="workspace_slug"
            label="Workspace slug"
            defaultValue="bombsell-workspace"
          />
          <PendingSubmitButton
            className="btn-solid w-fit"
            icon="add_business"
            pendingLabel="Creating workspace"
          >
            Create workspace
          </PendingSubmitButton>
        </form>
      </SurfaceSection>
    </div>
  );
}

function approvalsFromAutonomy(
  autonomy: Record<string, unknown> | null,
): string[] {
  if (!autonomy || !isRecord(autonomy.channels)) return [];
  return Object.values(autonomy.channels)
    .map((policy) =>
      isRecord(policy) && typeof policy.approval === "string"
        ? policy.approval
        : null,
    )
    .filter((policy): policy is string => Boolean(policy));
}

function settingsMode(
  settings: Record<string, unknown>,
  approvals: readonly string[],
): SettingsAutonomyMode {
  if (settings.autonomy_mode === "review_only") return "review_only";
  if (settings.autonomy_mode === "autonomous") return "autonomous";
  if (approvals.length === 0) return "autonomous";
  if (approvals.every((approval) => approval === "always"))
    return "review_only";
  if (approvals.every((approval) => approval === "none")) return "autonomous";
  return "custom";
}

function modeLabel(mode: SettingsAutonomyMode): string {
  if (mode === "review_only") return "Review-only";
  if (mode === "custom") return "Mixed";
  return "Autonomous";
}

function profileWebsite(profile: ProductCompanyProfile | null): string {
  return (
    profile?.website_url ?? (profile?.domain ? `https://${profile.domain}` : "")
  );
}

function outlookMailbox(account: SettingsOutlookAccount): string {
  const mailbox = account.properties?.mailbox_email;
  return typeof mailbox === "string" && mailbox.trim()
    ? mailbox
    : account.display_name;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
