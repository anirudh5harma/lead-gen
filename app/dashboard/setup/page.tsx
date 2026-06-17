import Link from "next/link";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { ProfileIntelligence } from "@/components/dashboard/ProfileIntelligence";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import {
  getProductCompanyProfile,
  verifiedProductWorkspaceSession,
} from "@/core/product/app.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import {
  configureActivationAction,
  createWorkspaceAction,
  editCompanyProfileAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface SetupRepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: { voice?: string; story?: string };
  autonomy: {
    channels?: { email?: { daily_cap?: number; approval?: string } };
  };
}

interface SetupIcpRow {
  id: string;
  name: string;
  description: string;
  match_threshold: string;
  must_haves: Array<{ field?: string; op?: string; value?: unknown }>;
}

interface SetupAccountRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
}

async function loadSetupState(workspaceId: string) {
  const pool = getPool();
  const [reps, icps, accounts] = await Promise.all([
    pool.query<SetupRepRow>(
      `select id, name, role::text as role, status::text as status, persona, autonomy
       from reps
        where workspace_id = $1
          and status <> 'retired'
        order by created_at asc`,
      [workspaceId],
    ),
    pool.query<SetupIcpRow>(
      `select id, name, description, match_threshold::text as match_threshold, must_haves
         from workspace_icps
        where workspace_id = $1
        order by created_at asc`,
      [workspaceId],
    ),
    pool.query<SetupAccountRow>(
      `with ranked_accounts as (
         select id, display_name, kind::text as kind, status::text as status, daily_cap, created_at,
                row_number() over (
                  partition by case
                    when kind = 'oauth_outlook' then 'outlook:' || coalesce(
                      nullif(lower(properties ->> 'mailbox_email'), ''),
                      nullif(lower(display_name), ''),
                      id::text
                    )
                    else id::text
                  end
                  order by case
                             when kind = 'oauth_outlook' and status = 'connected' then 0
                             when kind = 'oauth_outlook' and status = 'needs_reauth' then 1
                             else 2
                           end,
                           case
                             when kind = 'oauth_outlook'
                               and properties -> 'outlook_subscription' is not null
                               and properties -> 'outlook_subscription' ->> 'clientState' is not null
                             then 0
                             else 1
                           end,
                           updated_at desc,
                           created_at desc
                ) as account_rank
           from channel_accounts
          where workspace_id = $1
            and kind in ('email_domain','oauth_outlook','linkedin_session','linkedin_oauth')
       )
       select id, display_name, kind, status, daily_cap, created_at
         from ranked_accounts
        where account_rank = 1
        order by case
                   when kind = 'oauth_outlook' then 0
                   when kind in ('linkedin_session','linkedin_oauth') then 1
                   else 2
                 end,
                 created_at asc`,
      [workspaceId],
    ),
  ]);
  return { reps: reps.rows, icps: icps.rows, accounts: accounts.rows };
}

export default async function SetupPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceSetup />;

  const pool = getPool();
  const productSession = verifiedProductWorkspaceSession({
    workspace_id: active.workspace.id,
    user_id: active.user_id,
  });
  const [state, profile] = await Promise.all([
    loadSetupState(active.workspace.id),
    getProductCompanyProfile(pool, productSession),
  ]);
  const rep = state.reps[0];
  const icp = state.icps[0];
  const outlookAccount = state.accounts.find(
    (row) => row.kind === "oauth_outlook",
  );
  const linkedInAccount = state.accounts.find((row) =>
    isLinkedInKind(row.kind),
  );
  const readyCount = [
    state.reps.length > 0,
    state.icps.length > 0,
    Boolean(profile),
    isConnected(outlookAccount),
    isConnected(linkedInAccount),
  ].filter(Boolean).length;

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Profile"
        title={
          <>
            Tell Bombsell <em>who to reach</em>.
          </>
        }
        description="Define your company, audience, voice, timing signals, and channel pace. Email and LinkedIn outreach work from this profile."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Ready" value={`${readyCount}/5`} />
            {profile?.company_name ? (
              <HeroStat label="Company" value={profile.company_name} />
            ) : null}
            {icp ? <HeroStat label="Audience" value={icp.name} /> : null}
          </div>
        }
      />

      <AgentSummary reps={state.reps} />

      <SurfaceSection title="Company context">
        <form
          action={editCompanyProfileAction}
          className="grid gap-4 rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 md:grid-cols-2"
        >
          <input
            type="hidden"
            name="return_to"
            value="/dashboard/prospecting"
          />
          <Field
            name="company_name"
            label="Company"
            defaultValue={profile?.company_name ?? ""}
            required
          />
          <Field
            name="website_url"
            label="Website"
            defaultValue={
              profile?.website_url ??
              (profile?.domain ? `https://${profile.domain}` : "")
            }
            required
          />
          <Field
            name="industry"
            label="Industry"
            defaultValue={profile?.industry ?? ""}
          />
          <div className="md:col-span-2">
            <TextArea
              name="description"
              label="Company description for personalization"
              defaultValue={profile?.description ?? ""}
              rows={4}
            />
          </div>
          <div className="md:col-span-2 flex flex-wrap items-center gap-3">
            <PendingSubmitButton
              className="btn-solid"
              icon="check"
              pendingLabel="Saving company"
            >
              Save company
            </PendingSubmitButton>
          </div>
        </form>
      </SurfaceSection>

      <ProfileIntelligence profile={profile} />

      <SurfaceSection title="Audience and pace">
        <form
          action={configureActivationAction}
          className="grid gap-4 rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5"
        >
          <input
            type="hidden"
            name="return_to"
            value="/dashboard/prospecting"
          />
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
            label="Outbound voice"
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
              defaultValue={String(
                rep?.autonomy.channels?.email?.daily_cap ??
                  outlookAccount?.daily_cap ??
                  25,
              )}
            />
            <Select
              name="approval"
              label="Review mode"
              defaultValue={rep?.autonomy.channels?.email?.approval ?? "none"}
              options={[
                ["none", "Autonomous after checks"],
                ["always", "Review every move"],
                ["approve_first", "Review the first move"],
                ["research_only", "Research only"],
              ]}
            />
          </div>
          <input
            type="hidden"
            name="icp_name"
            value={icp?.name ?? "Default audience"}
          />
          <input type="hidden" name="signal_kind" value="hiring" />
          <input
            type="hidden"
            name="match_threshold"
            value={icp ? Number(icp.match_threshold).toFixed(2) : "0.60"}
          />
          {rep ? (
            <input type="hidden" name="rep_id" value={rep.id} />
          ) : (
            <input type="hidden" name="rep_name" value="Outbound agent" />
          )}
          <PendingSubmitButton
            className="btn-solid w-fit"
            icon="check"
            pendingLabel="Saving guidance"
          >
            Save guidance
          </PendingSubmitButton>
        </form>
      </SurfaceSection>

      <SurfaceSection title="Email and LinkedIn channels">
        <div className="grid gap-3">
          <ChannelConnectRow
            account={outlookAccount}
            title="Outlook inbox"
            description="Use the customer's Microsoft 365 mailbox for founder-led outbound, native threading, and reply sync."
            href="/api/auth/outlook?return_to=%2Fdashboard%2Fsettings%23email"
            icon="mail"
            connectLabel="Connect Outlook"
            reconnectLabel="Reconnect Outlook"
          />
          <ChannelConnectRow
            account={linkedInAccount}
            title="LinkedIn account"
            description="Connect the native LinkedIn channel for connection requests, DMs, and comment-led warmup."
            href="/api/auth/linkedin?return_to=%2Fdashboard%2Fsettings%23linkedin"
            icon="forum"
            connectLabel="Connect LinkedIn"
            reconnectLabel="Reconnect LinkedIn"
          />
        </div>
      </SurfaceSection>
    </div>
  );
}

function ChannelConnectRow({
  account,
  title,
  description,
  href,
  icon,
  connectLabel,
  reconnectLabel,
}: {
  account: SetupAccountRow | undefined;
  title: string;
  description: string;
  href: string;
  icon: string;
  connectLabel: string;
  reconnectLabel: string;
}) {
  return (
    <div className="grid gap-4 rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          {account ? account.display_name : title}
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-3)]">
          {account ? accountSummary(account) : description}
        </p>
      </div>
      <Link
        href={href}
        prefetch={false}
        className="btn-solid w-fit"
      >
        <Icon name={icon} size={16} />
        {account ? reconnectLabel : connectLabel}
      </Link>
    </div>
  );
}

function isConnected(account: SetupAccountRow | undefined): boolean {
  return account?.status === "connected";
}

function isLinkedInKind(kind: string): boolean {
  return kind === "linkedin_session" || kind === "linkedin_oauth";
}

function accountSummary(account: SetupAccountRow): string {
  return `${accountKindLabel(account.kind)} - ${account.status} - ${
    account.daily_cap ?? "unlimited"
  } daily ceiling`;
}

function accountKindLabel(kind: string): string {
  if (kind === "oauth_outlook") return "Outlook inbox";
  if (kind === "linkedin_session") return "LinkedIn session";
  if (kind === "linkedin_oauth") return "LinkedIn account";
  if (kind === "email_domain") return "Owned sender";
  return kind.replace(/_/g, " ");
}

function NoWorkspaceSetup() {
  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Profile"
        title="Create a workspace."
        description="Start with a named workspace. Then define the profile and outreach channels."
      />
      <SurfaceSection title="Workspace">
        <form
          action={createWorkspaceAction}
          className="grid gap-4 rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 md:max-w-xl"
        >
          <input
            type="hidden"
            name="return_to"
            value="/dashboard/prospecting"
          />
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

const AGENT_META: Record<
  string,
  { role: string; surface: string; href: string; icon: string }
> = {
  "Outbound agent": {
    role: "Email + LinkedIn",
    surface: "Finds verified contacts and moves outreach",
    href: "/dashboard/conversations",
    icon: "forum",
  },
};

const AGENT_ORDER = ["Outbound agent"];
const HIDDEN_REP_NAMES = new Set(["Vaani", "Bodh"]);

function AgentSummary({ reps }: { reps: SetupRepRow[] }) {
  const byName = new Map(reps.map((r) => [agentDisplayName(r.role), r]));
  const ordered = [
    ...AGENT_ORDER.map((name) => byName.get(name) ?? null),
    ...reps.filter(
      (rep) =>
        !AGENT_ORDER.includes(agentDisplayName(rep.role)) &&
        !HIDDEN_REP_NAMES.has(rep.name),
    ),
  ];
  return (
    <SurfaceSection title="Agent motion">
      <div className="grid gap-3 sm:grid-cols-2">
        {ordered.map((r, index) => {
          const name = r ? agentDisplayName(r.role) : AGENT_ORDER[index];
          const meta = AGENT_META[name] ?? {
            role: r?.role ?? "Custom",
            surface: r?.persona.story ?? "Custom work pattern",
            href: "/dashboard/agent",
            icon: "person",
          };
          const status = r?.status ?? "absent";
          return (
            <Link
              key={name}
              href={r ? `/dashboard/agent/${r.id}` : meta.href}
              prefetch={false}
              className="group rounded-lg border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 transition-colors hover:bg-[var(--color-ink-2)]/40"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name={meta.icon} size={15} />
                </span>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                  {meta.role}
                </p>
              </div>
              <p
                className="mt-4 text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {name}
              </p>
              <p className="mt-1 text-[13px] text-[var(--color-text-2)]">
                {meta.surface}
              </p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                {status === "active"
                  ? "Active"
                  : status === "absent"
                    ? "Not set up"
                    : status}
              </p>
            </Link>
          );
        })}
      </div>
    </SurfaceSection>
  );
}

function agentDisplayName(role: string): string {
  if (role === "sdr") return "Outbound agent";
  return "Agent";
}
