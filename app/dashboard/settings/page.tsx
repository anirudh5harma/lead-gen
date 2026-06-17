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
import { getRequestAuthIdentity } from "@/lib/auth";
import type { RequestAuthIdentity } from "@/lib/auth";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import {
  configureActivationAction,
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

interface SettingsLinkedInAccount {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
  updated_at: Date;
}

interface SettingsRepRow {
  id: string;
  name: string;
  persona: { voice?: string; story?: string };
  autonomy: {
    channels?: { email?: { daily_cap?: number; approval?: string } };
  } | null;
}

interface SettingsIcpRow {
  id: string;
  name: string;
  description: string;
  match_threshold: string;
}

interface SettingsState {
  settings: Record<string, unknown>;
  outlookAccount: SettingsOutlookAccount | null;
  linkedInAccount: SettingsLinkedInAccount | null;
  rep: SettingsRepRow | null;
  icp: SettingsIcpRow | null;
  approvals: string[];
}

async function loadSettingsState(workspaceId: string): Promise<SettingsState> {
  const pool = getPool();
  const [workspace, outlook, linkedIn, rep, icp, policies] = await Promise.all([
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
    pool.query<SettingsLinkedInAccount>(
      `select id,
              display_name,
              status::text as status,
              daily_cap,
              last_error,
              updated_at
         from channel_accounts
        where workspace_id = $1
          and kind in ('linkedin_session','linkedin_oauth')
        order by case when status = 'connected' then 0 else 1 end,
                 updated_at desc,
                 created_at desc
        limit 1`,
      [workspaceId],
    ),
    pool.query<SettingsRepRow>(
      `select id, name, persona, autonomy
         from reps
        where workspace_id = $1
          and status <> 'retired'
        order by case name when 'Sampark' then 0 else 1 end,
                 created_at asc
        limit 1`,
      [workspaceId],
    ),
    pool.query<SettingsIcpRow>(
      `select id, name, description, match_threshold::text as match_threshold
         from workspace_icps
        where workspace_id = $1
        order by created_at asc
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
    linkedInAccount: linkedIn.rows[0] ?? null,
    rep: rep.rows[0] ?? null,
    icp: icp.rows[0] ?? null,
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
  const identity = await getRequestAuthIdentity();
  const mode = settingsMode(state.settings, state.approvals);
  const formMode = mode === "review_only" ? "review_only" : "autonomous";
  const outlookLabel = state.outlookAccount
    ? outlookMailbox(state.outlookAccount)
    : "Not connected";
  const linkedInLabel = state.linkedInAccount
    ? statusLabel(state.linkedInAccount.status)
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
            <HeroStat label="Email" value={outlookLabel} />
            <HeroStat label="LinkedIn" value={linkedInLabel} />
            <HeroStat label="Mode" value={modeLabel(mode)} />
          </div>
        }
      />

      <SettingsChecklist
        profile={profile}
        outlookAccount={state.outlookAccount}
        linkedInAccount={state.linkedInAccount}
        rep={state.rep}
        icp={state.icp}
        mode={mode}
      />

      <div id="profile">
        <SurfaceSection title="Profile">
          <ProfileSettingsForm profile={profile} />
        </SurfaceSection>
      </div>

      <div id="motion">
        <SurfaceSection title="Audience and Rep">
          <ActivationSettingsForm
            rep={state.rep}
            icp={state.icp}
            outlookAccount={state.outlookAccount}
          />
        </SurfaceSection>
      </div>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <SurfaceSection title="Account">
          <AccountPanel
            identity={identity}
            workspaceName={active.workspace.name}
            workspaceSlug={active.workspace.slug}
            role={active.role}
          />
        </SurfaceSection>

        <SurfaceSection title="Connected accounts">
          <div className="grid gap-3">
            <OutlookPanel account={state.outlookAccount} />
            <LinkedInPanel account={state.linkedInAccount} />
          </div>
        </SurfaceSection>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div id="autonomy">
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
        </div>

        <SurfaceSection title="Integrations">
          <IntegrationPanel />
        </SurfaceSection>
      </section>
    </div>
  );
}

function SettingsChecklist({
  profile,
  outlookAccount,
  linkedInAccount,
  rep,
  icp,
  mode,
}: {
  profile: ProductCompanyProfile | null;
  outlookAccount: SettingsOutlookAccount | null;
  linkedInAccount: SettingsLinkedInAccount | null;
  rep: SettingsRepRow | null;
  icp: SettingsIcpRow | null;
  mode: SettingsAutonomyMode;
}) {
  const steps = [
    {
      title: "Company profile",
      detail: profile?.company_name
        ? `${profile.company_name}${profileWebsite(profile) ? ` - ${profileWebsite(profile)}` : ""}`
        : "Add the company and website that Reps should represent.",
      href: "#profile",
      icon: "add_business",
      ready: Boolean(profile?.company_name && profileWebsite(profile)),
    },
    {
      title: "Audience and Rep",
      detail:
        rep && icp
          ? `${rep.name} acts on ${icp.name}.`
          : "Define the ICP, voice, daily ceiling, and first Rep.",
      href: "#motion",
      icon: "badge",
      ready: Boolean(rep && icp),
    },
    {
      title: "Email account",
      detail: outlookAccount
        ? `${outlookMailbox(outlookAccount)} - ${statusLabel(outlookAccount.status)}`
        : "Connect Outlook for native email threads and reply sync.",
      href: "/api/auth/outlook",
      icon: "mail",
      ready: outlookAccount?.status === "connected",
    },
    {
      title: "LinkedIn account",
      detail: linkedInAccount
        ? `${linkedInAccount.display_name} - ${statusLabel(linkedInAccount.status)}`
        : "Connect LinkedIn for connection requests and DMs.",
      href: "/api/auth/linkedin",
      icon: "forum",
      ready: linkedInAccount?.status === "connected",
    },
    {
      title: "Review posture",
      detail:
        mode === "custom"
          ? "Rep and Play policies are mixed."
          : mode === "review_only"
            ? "Every outbound move waits for review."
            : "Reps can move after evals, caps, and channel checks pass.",
      href: "#autonomy",
      icon: "task_alt",
      ready: mode !== "custom",
    },
  ];
  const readyCount = steps.filter((step) => step.ready).length;
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Setup
          </p>
          <h2
            className="mt-1 text-[18px] font-semibold text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Profile, channels, and guardrails.
          </h2>
        </div>
        <span className="rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-1 font-mono text-[12px] text-[var(--color-text-2)]">
          {readyCount}/{steps.length} ready
        </span>
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {steps.map((step) => (
          <Link
            key={step.title}
            href={step.href}
            prefetch={false}
            className="group flex min-h-[142px] flex-col rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]/50"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                <Icon name={step.icon} size={16} />
              </span>
              <StatusPill ready={step.ready} />
            </div>
            <p className="mt-4 text-sm font-semibold text-[var(--color-text-1)]">
              {step.title}
            </p>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
              {step.detail}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function StatusPill({ ready }: { ready: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[11px] font-medium " +
        (ready
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
      }
    >
      <Icon name={ready ? "check_circle" : "lock"} size={12} />
      {ready ? "Ready" : "Needed"}
    </span>
  );
}

function AccountPanel({
  identity,
  workspaceName,
  workspaceSlug,
  role,
}: {
  identity: RequestAuthIdentity | null;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
}) {
  const email = identity?.email ?? "Signed in";
  return (
    <div className="section-note grid gap-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-sm font-semibold text-[var(--color-text-2)]">
          {accountInitials(email)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {email}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            {roleLabel(role)} in {workspaceName}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ProfileFact label="Workspace" value={workspaceName} />
        <ProfileFact label="Slug" value={workspaceSlug} />
      </div>
    </div>
  );
}

function IntegrationPanel() {
  return (
    <div className="section-note grid gap-4">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name="account_tree" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            MCP server
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            External agents can use the same workspace tools through the MCP endpoint.
          </p>
        </div>
      </div>
      <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-xs text-[var(--color-text-2)]">
        /api/mcp
      </div>
      <Link href="/dashboard/integrations" prefetch={false} className="btn-quiet-sm w-fit">
        <Icon name="arrow_forward" size={14} />
        Manage integrations
      </Link>
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

function ActivationSettingsForm({
  rep,
  icp,
  outlookAccount,
}: {
  rep: SettingsRepRow | null;
  icp: SettingsIcpRow | null;
  outlookAccount: SettingsOutlookAccount | null;
}) {
  const dailyCap =
    rep?.autonomy?.channels?.email?.daily_cap ?? outlookAccount?.daily_cap ?? 25;
  const approval = rep?.autonomy?.channels?.email?.approval ?? "none";
  return (
    <form action={configureActivationAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/settings#motion" />
      <TextArea
        name="icp_description"
        label="Target companies and people"
        rows={3}
        defaultValue={
          icp?.description ??
          "Companies showing fresh hiring intent around GTM, operations, or revenue roles."
        }
      />
      <TextArea
        name="rep_voice"
        label="Rep voice"
        rows={3}
        defaultValue={
          rep?.persona.voice ??
          "Direct, warm, specific, and allergic to generic sales fluff."
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          name="daily_cap"
          label="Daily ceiling"
          type="number"
          defaultValue={String(dailyCap)}
        />
        <Select
          name="approval"
          label="Review mode"
          defaultValue={approval}
          options={[
            ["none", "Autonomous after checks"],
            ["always", "Review every move"],
            ["approve_first", "Review the first move"],
            ["research_only", "Research only"],
          ]}
        />
      </div>
      <input type="hidden" name="icp_name" value={icp?.name ?? "Default audience"} />
      <input type="hidden" name="signal_kind" value="hiring" />
      <input
        type="hidden"
        name="match_threshold"
        value={icp ? Number(icp.match_threshold).toFixed(2) : "0.60"}
      />
      <input type="hidden" name="rep_name" value={rep?.name ?? "Sampark"} />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="check"
        pendingLabel="Saving motion"
      >
        Save audience and Rep
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

function LinkedInPanel({
  account,
}: {
  account: SettingsLinkedInAccount | null;
}) {
  return (
    <div className="section-note grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon
            name={account?.status === "connected" ? "forum" : "sync_problem"}
            size={18}
          />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {account ? account.display_name : "LinkedIn account"}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            {account
              ? `${statusLabel(account.status)} - ${account.daily_cap ?? "unlimited"} daily ceiling`
              : "Connect LinkedIn for connection requests, DMs, and warmup Plays."}
          </p>
          {account?.last_error ? (
            <p className="mt-2 text-sm text-[#ffb4a8]">{account.last_error}</p>
          ) : null}
        </div>
      </div>
      <Link
        href="/api/auth/linkedin"
        prefetch={false}
        className="btn-solid w-fit"
      >
        <Icon name="forum" size={16} />
        {account ? "Reconnect LinkedIn" : "Connect LinkedIn"}
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

function Select({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: Array<[string, string]>;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-[var(--color-text-3)]">
        {label}
      </span>
      <select
        name={name}
        defaultValue={defaultValue}
        className="min-h-10 rounded-[8px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
      >
        {options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
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

function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Member";
}

function accountInitials(value: string): string {
  const [first = "B", second = "S"] = value
    .split(/[\s@._-]+/)
    .filter(Boolean);
  return `${first[0] ?? "B"}${second[0] ?? "S"}`.toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
