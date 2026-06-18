import Link from "next/link";
import type { ReactNode } from "react";
import BrandIcon from "@/components/BrandIcon";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import {
  getProductCompanyProfile,
  getProductLaunchReadiness,
  verifiedProductWorkspaceSession,
  type ProductCompanyProfile,
  type ProductLaunchReadinessResult,
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

type ProfileAutonomyMode = "autonomous" | "review_only" | "custom";

interface ProfileOutlookAccount {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
  properties: Record<string, unknown> | null;
  updated_at: Date;
}

interface ProfileLinkedInAccount {
  id: string;
  display_name: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
  updated_at: Date;
}

interface ProfileRepRow {
  id: string;
  name: string;
  role: string;
  persona: { voice?: string; story?: string };
  autonomy: {
    channels?: { email?: { daily_cap?: number; approval?: string } };
  } | null;
}

interface ProfileIcpRow {
  id: string;
  name: string;
  description: string;
  match_threshold: string;
}

interface ProfileSuppressionStats {
  total: number;
  bounces: number;
  unsubscribes: number;
  doNotContact: number;
}

interface ProfileSuppressionRow {
  id: string;
  kind: string;
  recorded_at: Date;
  conversation_id: string | null;
  counterparty_name: string | null;
  company_name: string | null;
}

interface ProfileContactQuality {
  people: number;
  emailHandles: number;
  verifiedEmails: number;
  linkedInProfiles: number;
  reachable: number;
}

interface ProfileState {
  settings: Record<string, unknown>;
  outlookAccount: ProfileOutlookAccount | null;
  linkedInAccount: ProfileLinkedInAccount | null;
  linkedInAccounts: ProfileLinkedInAccount[];
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  approvals: string[];
  suppressionStats: ProfileSuppressionStats;
  recentSuppressions: ProfileSuppressionRow[];
  contactQuality: ProfileContactQuality;
}

async function loadProfileState(workspaceId: string): Promise<ProfileState> {
  const pool = getPool();
  const [
    workspace,
    outlook,
    linkedIn,
    rep,
    icp,
    policies,
    suppressionStats,
    recentSuppressions,
    contactQuality,
  ] = await Promise.all([
    pool.query<{ settings: Record<string, unknown> }>(
      `select settings
         from workspaces
        where id = $1`,
      [workspaceId],
    ),
    pool.query<ProfileOutlookAccount>(
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
    pool.query<ProfileLinkedInAccount>(
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
        limit 2`,
      [workspaceId],
    ),
    pool.query<ProfileRepRow>(
      `select id, name, role::text as role, persona, autonomy
         from reps
        where workspace_id = $1
          and status <> 'retired'
        order by created_at asc
        limit 1`,
      [workspaceId],
    ),
    pool.query<ProfileIcpRow>(
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
    pool.query<{
      total: string;
      bounces: string;
      unsubscribes: string;
      do_not_contact: string;
    }>(
      `select count(*)::text as total,
              count(*) filter (where kind = 'bounce')::text as bounces,
              count(*) filter (where kind = 'unsubscribe')::text as unsubscribes,
              count(*) filter (where kind = 'do_not_contact')::text as do_not_contact
         from outcomes
        where workspace_id = $1
          and kind in ('bounce','unsubscribe','do_not_contact')`,
      [workspaceId],
    ),
    pool.query<ProfileSuppressionRow>(
      `select o.id,
              o.kind::text as kind,
              o.recorded_at,
              o.conversation_id,
              p.full_name as counterparty_name,
              co.name as company_name
         from outcomes o
         left join conversations c on c.id = o.conversation_id
         left join graph_persons p on p.id = coalesce(o.subject_person_id, c.counterparty_person_id)
         left join graph_companies co on co.id = coalesce(o.subject_company_id, c.counterparty_company_id)
        where o.workspace_id = $1
          and o.kind in ('bounce','unsubscribe','do_not_contact')
        order by coalesce(o.recorded_at, o.occurred_at) desc
        limit 5`,
      [workspaceId],
    ),
    pool.query<{
      people: string;
      email_handles: string;
      verified_emails: string;
      linkedin_profiles: string;
      reachable: string;
    }>(
      `select count(*)::text as people,
              count(*) filter (where cardinality(p.emails) > 0)::text as email_handles,
              count(*) filter (
                where exists (
                  select 1
                    from jsonb_each(coalesce(p.properties->'email_verification', '{}'::jsonb)) as ev(email, meta)
                   where lower(coalesce(ev.meta->>'verified', '')) = 'true'
                      or lower(coalesce(ev.meta->>'status', '')) in ('valid', 'deliverable')
                )
              )::text as verified_emails,
              count(*) filter (where p.linkedin_url is not null)::text as linkedin_profiles,
              count(*) filter (
                where cardinality(p.emails) > 0
                   or p.linkedin_url is not null
              )::text as reachable
         from graph_persons p
        where p.workspace_id = $1`,
      [workspaceId],
    ),
  ]);
  const suppressions = suppressionStats.rows[0];
  const contacts = contactQuality.rows[0];
  return {
    settings: workspace.rows[0]?.settings ?? {},
    outlookAccount: outlook.rows[0] ?? null,
    linkedInAccount: linkedIn.rows[0] ?? null,
    linkedInAccounts: linkedIn.rows,
    rep: rep.rows[0] ?? null,
    icp: icp.rows[0] ?? null,
    approvals: policies.rows.flatMap((row) =>
      approvalsFromAutonomy(row.autonomy),
    ),
    suppressionStats: {
      total: Number(suppressions?.total ?? 0),
      bounces: Number(suppressions?.bounces ?? 0),
      unsubscribes: Number(suppressions?.unsubscribes ?? 0),
      doNotContact: Number(suppressions?.do_not_contact ?? 0),
    },
    recentSuppressions: recentSuppressions.rows,
    contactQuality: {
      people: Number(contacts?.people ?? 0),
      emailHandles: Number(contacts?.email_handles ?? 0),
      verifiedEmails: Number(contacts?.verified_emails ?? 0),
      linkedInProfiles: Number(contacts?.linkedin_profiles ?? 0),
      reachable: Number(contacts?.reachable ?? 0),
    },
  };
}

export default async function ProfilePage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceProfile />;

  const pool = getPool();
  const productSession = verifiedProductWorkspaceSession({
    workspace_id: active.workspace.id,
    user_id: active.user_id,
  });
  const [profile, state, readiness] = await Promise.all([
    getProductCompanyProfile(pool, productSession),
    loadProfileState(active.workspace.id),
    getProductLaunchReadiness({ required_channel: "any" }, productSession),
  ]);
  const identity = await getRequestAuthIdentity();
  const mode = profileMode(state.settings, state.approvals);
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
        kicker="Profile"
        title={
          <>
            Profile and <em>integrations</em>.
          </>
        }
        description="Company context, buyer fit, email, LinkedIn, contact quality, and connected tools in one setup surface."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat
              label="Profile"
              value={profile?.company_name ?? "Needed"}
            />
            <HeroStat label="Email" value={outlookLabel} />
            <HeroStat label="LinkedIn" value={linkedInLabel} />
            <HeroStat
              label="Channels ready"
              value={channelReadinessCount(state)}
            />
          </div>
        }
      />

      <ProfileSetupHub
        profile={profile}
        state={state}
        mode={mode}
        readiness={readiness}
      />

      <ProfileLaunchModel
        profile={profile}
        state={state}
        mode={mode}
        readiness={readiness}
      />

      <ProfileSectionNav
        profile={profile}
        outlookAccount={state.outlookAccount}
        linkedInAccount={state.linkedInAccount}
        rep={state.rep}
        icp={state.icp}
        mode={mode}
        suppressionStats={state.suppressionStats}
        contactQuality={state.contactQuality}
      />

      <div id="profile">
        <SurfaceSection title="Profile">
          <CompanyProfileForm profile={profile} />
        </SurfaceSection>
      </div>

      <span id="motion" className="block scroll-mt-28" aria-hidden="true" />
      <div id="agent">
        <SurfaceSection title="Agent inputs and outreach templates">
          <AgentActivationForm
            rep={state.rep}
            icp={state.icp}
            outlookAccount={state.outlookAccount}
          />
        </SurfaceSection>
      </div>

      <div id="contact-quality">
        <SurfaceSection title="Contact quality">
          <ContactQualityPanel stats={state.contactQuality} />
        </SurfaceSection>
      </div>

      <section className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div id="account">
          <SurfaceSection title="Account">
            <AccountPanel
              identity={identity}
              workspaceName={active.workspace.name}
              workspaceSlug={active.workspace.slug}
              role={active.role}
            />
          </SurfaceSection>
        </div>

        <section id="channels" className="grid scroll-mt-28 gap-6 md:grid-cols-2">
          <div id="email">
            <SurfaceSection title="Email integration">
              <OutlookPanel account={state.outlookAccount} />
            </SurfaceSection>
          </div>

          <div id="linkedin">
            <SurfaceSection title="LinkedIn integration">
              <LinkedInPanel accounts={state.linkedInAccounts} />
            </SurfaceSection>
          </div>
        </section>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-6">
          <div id="autonomy">
            <SurfaceSection title="Autonomy">
              <form
                action={updateWorkspaceAutonomyAction}
                className="section-note grid gap-5"
              >
                <input type="hidden" name="return_to" value="/dashboard/profile" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <AutonomyOption
                    value="autonomous"
                    title="Autopilot"
                    description="Send after evals, caps, contact checks, and channel health pass."
                    defaultChecked={formMode === "autonomous"}
                  />
                  <AutonomyOption
                    value="review_only"
                    title="Copilot review"
                    description="Prepare every move, then wait for a human approval before outreach."
                    defaultChecked={formMode === "review_only"}
                  />
                </div>
                {mode === "custom" ? (
                  <p className="text-sm text-[var(--color-text-3)]">
                    Current agent and outreach policies are mixed. Saving here
                    applies one mode across the workspace.
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

          <div id="blocklist">
            <SurfaceSection title="Blocklist">
              <BlocklistPanel
                stats={state.suppressionStats}
                recent={state.recentSuppressions}
              />
            </SurfaceSection>
          </div>
        </div>

        <div id="tools">
          <SurfaceSection title="Tool integrations">
            <IntegrationPanel />
          </SurfaceSection>
        </div>
      </section>
    </div>
  );
}

function ProfileSetupHub({
  profile,
  state,
  mode,
  readiness,
}: {
  profile: ProductCompanyProfile | null;
  state: ProfileState;
  mode: ProfileAutonomyMode;
  readiness: ProductLaunchReadinessResult;
}) {
  const website = profileWebsite(profile);
  const connectedChannels = [
    state.outlookAccount?.status === "connected" ? "email" : null,
    state.linkedInAccount?.status === "connected" ? "LinkedIn" : null,
  ].filter(Boolean);
  const channelSummary =
    connectedChannels.length > 0
      ? connectedChannels.join(" + ")
      : "Connect email or LinkedIn";
  const contactSummary =
    state.contactQuality.reachable > 0
      ? `${state.contactQuality.reachable} reachable contacts`
      : "Waiting on verified contacts";
  const next = profileReadinessNextAction(readiness);
  const setupItems = [
    {
      title: "Company profile",
      detail: profile?.company_name
        ? `${profile.company_name}${website ? ` - ${website}` : ""}`
        : "Add the website and positioning the agent should represent.",
      href: "#profile",
      icon: "add_business",
      ready: Boolean(profile?.company_name && website),
    },
    {
      title: "Agent and buyer fit",
      detail:
        state.rep && state.icp
          ? `${agentDisplayName(state.rep.role)} acts on ${state.icp.name}.`
          : "Define the buyer profile, voice, daily ceiling, and approval mode.",
      href: "#agent",
      icon: "badge",
      ready: Boolean(state.rep && state.icp),
    },
    {
      title: "Email",
      detail: state.outlookAccount
        ? `${outlookMailbox(state.outlookAccount)} - ${statusLabel(state.outlookAccount.status)}`
        : "Connect Outlook for native email threads and reply sync.",
      href: "#email",
      icon: "mail",
      ready: state.outlookAccount?.status === "connected",
    },
    {
      title: "LinkedIn",
      detail: state.linkedInAccount
        ? `${state.linkedInAccount.display_name} - ${statusLabel(state.linkedInAccount.status)}`
        : "Connect LinkedIn for connection requests and DMs.",
      href: "#linkedin",
      icon: "linkedin",
      ready: state.linkedInAccount?.status === "connected",
    },
    {
      title: "Contact quality",
      detail: `${contactSummary}; ${state.contactQuality.verifiedEmails} verified emails and ${state.contactQuality.linkedInProfiles} LinkedIn profiles.`,
      href: "#contact-quality",
      icon: "verified",
      ready: state.contactQuality.reachable > 0,
    },
    {
      title: "Control mode",
      detail:
        mode === "custom"
          ? "Agent and outreach policies are mixed."
          : mode === "review_only"
            ? "Copilot waits for approval before outreach."
            : "Autopilot can send after evals and channel checks pass.",
      href: "#autonomy",
      icon: "task_alt",
      ready: mode !== "custom",
    },
  ];
  const readyCount = setupItems.filter((step) => step.ready).length;
  return (
    <section className="section-note grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Setup hub
          </p>
          <h2
            className="mt-1 text-[18px] font-semibold text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Profile, email, LinkedIn, contacts, and Agent controls.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
            Website context shapes the buyer profile, connected accounts unlock
            outreach, and verified contact coverage decides whether the Agent can
            turn quality signals into email or LinkedIn touches.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-1 font-mono text-[12px] text-[var(--color-text-2)]">
            {readyCount}/{setupItems.length} ready
          </span>
          <Link href={next.href} prefetch={false} className="btn-solid-sm">
            <Icon name={next.icon} size={14} />
            {next.label}
          </Link>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {setupItems.map((step) => (
          <Link
            key={step.title}
            href={step.href}
            prefetch={false}
            className="group flex min-h-[150px] flex-col rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]/50"
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
      <div className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 md:grid-cols-[1fr_auto] md:items-center">
        <p className="text-sm leading-6 text-[var(--color-text-3)]">
          {readiness.launch_ready
            ? `Ready: ${channelSummary} can now move qualified signals into outreach.`
            : `${readiness.blockers.length} launch blocker${readiness.blockers.length === 1 ? "" : "s"} remaining before outreach can run.`}
        </p>
        <Link
          href="/dashboard/agent#opportunities"
          prefetch={false}
          className="btn-quiet-sm w-fit"
        >
          <Icon name="arrow_forward" size={14} />
          Open Agent
        </Link>
      </div>
    </section>
  );
}

function profileReadinessNextAction(
  readiness: ProductLaunchReadinessResult,
): { href: string; icon: string; label: string } {
  const blocker = readiness.checks.find(
    (check) => check.required && check.status !== "ready",
  );
  if (!blocker?.action) {
    return {
      href: "/dashboard/agent#opportunities",
      icon: "rocket_launch",
      label: "Open Agent",
    };
  }
  return {
    href: blocker.action.surface,
    icon: readinessActionIcon(blocker.id),
    label: blocker.action.label,
  };
}

function ProfileLaunchModel({
  profile,
  state,
  mode,
  readiness,
}: {
  profile: ProductCompanyProfile | null;
  state: ProfileState;
  mode: ProfileAutonomyMode;
  readiness: ProductLaunchReadinessResult;
}) {
  const buyerFit =
    state.icp?.description ??
    profile?.target_titles ??
    profile?.target_markets ??
    "Define the companies and people the agent should qualify before outreach.";
  const signals = profileSignalList(profile);
  const contactCoverage =
    state.contactQuality.people > 0
      ? `${state.contactQuality.reachable}/${state.contactQuality.people} reachable`
      : "Waiting for first contacts";
  const matchThreshold = state.icp
    ? `${Math.round(Number(state.icp.match_threshold) * 100)}% fit gate`
    : "Fit gate pending";
  const channelPaths = [
    {
      title: "Email path",
      icon: <BrandIcon name="microsoft" size={16} />,
      ready: state.outlookAccount?.status === "connected",
      detail: state.outlookAccount
        ? `${outlookMailbox(state.outlookAccount)} - ${statusLabel(state.outlookAccount.status)}`
        : "Connect Outlook for native sends and reply sync.",
      href: "#email",
    },
    {
      title: "LinkedIn path",
      icon: <BrandIcon name="linkedin" size={16} />,
      ready: state.linkedInAccount?.status === "connected",
      detail: state.linkedInAccount
        ? `${state.linkedInAccount.display_name} - ${statusLabel(state.linkedInAccount.status)}`
        : "Connect LinkedIn for connection requests and DMs.",
      href: "#linkedin",
    },
  ];
  return (
    <section className="section-note grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Launch model
          </p>
          <h2
            className="mt-1 text-[18px] font-semibold text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            What the agent learned and how it can act.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
            Profile turns the website, buyer fit, signal watchlist, channel
            accounts, contact coverage, and review mode into one operating model.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill ready={readiness.launch_ready} />
          <span className="rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-1 text-xs text-[var(--color-text-3)]">
            {modeLabel(mode)}
          </span>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <article className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
              <Icon name="person_search" size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Buyer fit
              </p>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-[var(--color-text-3)]">
                {buyerFit}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <LaunchModelPill icon="fact_check">{matchThreshold}</LaunchModelPill>
                <LaunchModelPill icon="verified">{contactCoverage}</LaunchModelPill>
                <LaunchModelPill icon="block">
                  {profile?.prevent_team_contact_duplication === false
                    ? "Duplicate checks off"
                    : "Duplicate checks on"}
                </LaunchModelPill>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
              <Icon name="sensors" size={17} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Signals watched
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
                {signals.length > 0
                  ? "These terms guide source checks and contact matching."
                  : "Add signal keywords and competitors so source checks find timing evidence."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {(signals.length > 0 ? signals : ["Launches", "Hiring", "Competitors"]).map(
                  (signal) => (
                    <span
                      key={signal}
                      className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]"
                    >
                      {signal}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>
        </article>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {channelPaths.map((path) => (
          <Link
            key={path.title}
            href={path.href}
            prefetch={false}
            className="group rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-3">
                <span
                  className={
                    "grid size-9 shrink-0 place-items-center rounded-[8px] " +
                    (path.ready
                      ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                      : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
                  }
                >
                  {path.icon}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                    {path.title}
                  </span>
                  <span className="mt-1 block truncate text-sm text-[var(--color-text-3)]">
                    {path.detail}
                  </span>
                </span>
              </span>
              <StatusPill ready={path.ready} />
            </span>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 md:grid-cols-[1fr_auto] md:items-center">
        <p className="text-sm leading-6 text-[var(--color-text-3)]">
          {readiness.launch_ready
            ? "The agent can now move qualified signals into verified email or LinkedIn outreach after evals, caps, and review rules pass."
            : "Finish the launch blockers above so qualified signals can become verified contacts, judged drafts, and replies."}
        </p>
        <Link href="/dashboard/agent#opportunities" prefetch={false} className="btn-quiet-sm w-fit">
          <Icon name="arrow_forward" size={14} />
          Open signal queue
        </Link>
      </div>
    </section>
  );
}

function LaunchModelPill({
  icon,
  children,
}: {
  icon: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

function profileSignalList(profile: ProductCompanyProfile | null): string[] {
  const terms = [
    ...splitProfileTerms(profile?.signal_keywords),
    ...splitProfileTerms(profile?.competitor_watchlist),
    ...(profile?.exa_market_terms ?? []),
    ...(profile?.exa_competitor_mentions ?? []),
  ];
  const seen = new Set<string>();
  const compact: string[] = [];
  for (const term of terms) {
    const clean = term.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    compact.push(clean.length > 28 ? clean.slice(0, 25) + "..." : clean);
    if (compact.length === 5) break;
  }
  return compact;
}

function splitProfileTerms(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readinessActionIcon(
  id: ProductLaunchReadinessResult["checks"][number]["id"],
): string {
  if (id === "workspace_profile") return "add_business";
  if (id === "icp" || id === "rep") return "badge";
  if (id === "signal_sources") return "sensors";
  if (id === "plays") return "send";
  if (id === "linkedin") return "linkedin";
  return "mail";
}

function ProfileSectionNav({
  profile,
  outlookAccount,
  linkedInAccount,
  rep,
  icp,
  mode,
  suppressionStats,
  contactQuality,
}: {
  profile: ProductCompanyProfile | null;
  outlookAccount: ProfileOutlookAccount | null;
  linkedInAccount: ProfileLinkedInAccount | null;
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  mode: ProfileAutonomyMode;
  suppressionStats: ProfileSuppressionStats;
  contactQuality: ProfileContactQuality;
}) {
  const sections = [
    {
      title: "Company",
      detail: profile?.company_name ?? "Company profile",
      href: "#profile",
      icon: "add_business",
      ready: Boolean(profile?.company_name && profileWebsite(profile)),
    },
    {
      title: "Agent",
      detail: rep && icp ? `${agentDisplayName(rep.role)} + ${icp.name}` : "Audience and voice",
      href: "#agent",
      icon: "badge",
      ready: Boolean(rep && icp),
    },
    {
      title: "Templates",
      detail: "AI outreach templates",
      href: "#templates",
      icon: "edit_note",
      ready: Boolean(rep?.persona.story || rep?.persona.voice),
    },
    {
      title: "Contact quality",
      detail:
        contactQuality.reachable > 0
          ? `${contactQuality.reachable} reachable`
          : "Email and LinkedIn coverage",
      href: "#contact-quality",
      icon: "verified",
      ready: contactQuality.reachable > 0,
    },
    {
      title: "Account",
      detail: "User and workspace",
      href: "#account",
      icon: "person",
      ready: true,
    },
    {
      title: "Email",
      detail: outlookAccount ? outlookMailbox(outlookAccount) : "Connect Outlook",
      href: "#email",
      icon: "mail",
      ready: outlookAccount?.status === "connected",
    },
    {
      title: "LinkedIn",
      detail: linkedInAccount ? linkedInAccount.display_name : "Connect account",
      href: "#linkedin",
      icon: "linkedin",
      ready: linkedInAccount?.status === "connected",
    },
    {
      title: "Autonomy",
      detail: modeLabel(mode),
      href: "#autonomy",
      icon: "task_alt",
      ready: mode !== "custom",
    },
    {
      title: "Blocklist",
      detail:
        suppressionStats.total > 0
          ? `${suppressionStats.total} protected`
          : "Bounces and opt-outs",
      href: "#blocklist",
      icon: "report",
      ready: true,
    },
    {
      title: "Tools",
      detail: "MCP and channel tools",
      href: "#tools",
      icon: "account_tree",
      ready: true,
    },
  ];
  return (
    <nav
      aria-label="Profile sections"
      className="section-note flex gap-2 overflow-x-auto p-2"
    >
      {sections.map((section) => (
        <Link
          key={section.title}
          href={section.href}
          prefetch={false}
          className="group flex min-w-[154px] items-center gap-3 rounded-[8px] px-3 py-2 transition-colors hover:bg-[var(--color-ink-0)]"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
            <Icon name={section.icon} size={15} />
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-1)]">
              {section.title}
              <span
                className={
                  "size-1.5 rounded-full " +
                  (section.ready
                    ? "bg-[var(--color-pos)]"
                    : "bg-[var(--color-text-4)]")
                }
              />
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-3)]">
              {section.detail}
            </span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

function channelReadinessCount(state: ProfileState): string {
  const ready =
    (state.outlookAccount?.status === "connected" ? 1 : 0) +
    (state.linkedInAccount?.status === "connected" ? 1 : 0);
  return `${ready}/2 ready`;
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
      <Link href="/api/mcp" prefetch={false} className="btn-quiet-sm w-fit">
        <Icon name="arrow_forward" size={14} />
        Open endpoint
      </Link>
    </div>
  );
}

function CompanyProfileForm({
  profile,
}: {
  profile: ProductCompanyProfile | null;
}) {
  const website = profileWebsite(profile);
  return (
    <form action={editCompanyProfileAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/profile" />
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
        <Select
          name="company_size"
          label="Company size"
          defaultValue={profile?.company_size ?? ""}
          options={[
            ["", "Unspecified"],
            ["1-10", "1-10 employees"],
            ["11-50", "11-50 employees"],
            ["51-200", "51-200 employees"],
            ["201-500", "201-500 employees"],
            ["501-1000", "501-1000 employees"],
            ["1001-5000", "1001-5000 employees"],
            ["5001-10000", "5001-10000 employees"],
            ["10000+", "10000+ employees"],
          ]}
        />
      </div>
      <TextArea
        name="description"
        label="Company description"
        defaultValue={profile?.description ?? ""}
        rows={5}
      />
      <TextArea
        name="value_proposition"
        label="Value proposition"
        defaultValue={profile?.value_proposition ?? ""}
        rows={3}
      />
      <TextArea
        name="customer_pain_points"
        label="Customer pain points"
        defaultValue={profile?.customer_pain_points ?? ""}
        rows={3}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <TextArea
          name="target_titles"
          label="Buyer roles"
          defaultValue={profile?.target_titles ?? ""}
          rows={4}
        />
        <TextArea
          name="target_markets"
          label="Target markets"
          defaultValue={profile?.target_markets ?? ""}
          rows={4}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextArea
          name="key_features"
          label="Key features"
          defaultValue={profile?.key_features ?? ""}
          rows={4}
        />
        <TextArea
          name="social_proof"
          label="Social proof"
          defaultValue={profile?.social_proof ?? ""}
          rows={4}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <TextArea
          name="signal_keywords"
          label="Signal keywords"
          defaultValue={profile?.signal_keywords ?? ""}
          rows={4}
        />
        <TextArea
          name="competitor_watchlist"
          label="Competitors to watch"
          defaultValue={profile?.competitor_watchlist ?? ""}
          rows={4}
        />
      </div>
      <TextArea
        name="exclusion_rules"
        label="Do not contact"
        defaultValue={profile?.exclusion_rules ?? ""}
        rows={3}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Select
          name="preferred_language"
          label="Preferred language"
          defaultValue={profile?.preferred_language ?? "English (US)"}
          options={[
            ["English (US)", "English (US)"],
            ["English (UK)", "English (UK)"],
            ["Spanish", "Spanish"],
            ["French", "French"],
            ["German", "German"],
          ]}
        />
        <Select
          name="outreach_goal"
          label="Outreach goal"
          defaultValue={profile?.outreach_goal ?? "conversations"}
          options={[
            ["conversations", "Start conversations"],
            ["demos", "Book qualified demos"],
          ]}
        />
        <Select
          name="message_tone"
          label="Message tone"
          defaultValue={profile?.message_tone ?? "professional"}
          options={[
            ["professional", "Professional"],
            ["conversational", "Conversational"],
            ["direct", "Direct"],
          ]}
        />
      </div>
      <Field
        name="linkedin_company_url"
        label="LinkedIn company page"
        defaultValue={profile?.linkedin_company_url ?? ""}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <ProfilePreferenceCheckbox
          name="auto_enrich_email_addresses"
          title="Auto-enrich email addresses"
          detail="Find and verify missing emails before outreach drafts can send."
          defaultChecked={profile?.auto_enrich_email_addresses ?? true}
        />
        <ProfilePreferenceCheckbox
          name="prevent_team_contact_duplication"
          title="Prevent duplicate contacts"
          detail="Keep the same reachable person from being worked twice across the workspace."
          defaultChecked={profile?.prevent_team_contact_duplication ?? true}
        />
      </div>
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

function ProfilePreferenceCheckbox({
  name,
  title,
  detail,
  defaultChecked,
}: {
  name: string;
  title: string;
  detail: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-1 size-4 accent-[var(--color-accent)]"
      />
      <span>
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-text-3)]">
          {detail}
        </span>
      </span>
    </label>
  );
}

function AgentActivationForm({
  rep,
  icp,
  outlookAccount,
}: {
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  outlookAccount: ProfileOutlookAccount | null;
}) {
  const dailyCap =
    rep?.autonomy?.channels?.email?.daily_cap ?? outlookAccount?.daily_cap ?? 25;
  const approval = rep?.autonomy?.channels?.email?.approval ?? "none";
  return (
    <form action={configureActivationAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/profile#agent" />
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
        label="Agent voice"
        rows={3}
        defaultValue={
          rep?.persona.voice ??
          "Direct, warm, specific, and allergic to generic sales fluff."
        }
      />
      <div id="templates" className="grid gap-3">
        <TextArea
          name="rep_story"
          label="AI outreach template"
          rows={4}
          defaultValue={
            rep?.persona.story ??
            "Open with the qualified signal, name the verified contact or LinkedIn profile, tie it to one relevant business reason, and ask for one concrete next step."
          }
        />
        <p className="text-xs leading-5 text-[var(--color-text-3)]">
          Used by email and LinkedIn draft generation before hot-path quality
          checks decide whether anything can move.
        </p>
      </div>
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
      {rep ? (
        <input type="hidden" name="rep_id" value={rep.id} />
      ) : (
        <input type="hidden" name="rep_name" value="Outbound agent" />
      )}
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="check"
        pendingLabel="Saving agent"
      >
        Save audience and agent
      </PendingSubmitButton>
    </form>
  );
}

function OutlookPanel({ account }: { account: ProfileOutlookAccount | null }) {
  return (
    <div className="section-note grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="brief-note-icon shrink-0">
          <BrandIcon name="microsoft" size={18} />
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
        href="/api/auth/outlook?return_to=%2Fdashboard%2Fprofile%23email"
        prefetch={false}
        className="btn-solid w-fit"
      >
        <BrandIcon name="microsoft" size={16} />
        {account ? "Reconnect Outlook" : "Connect Outlook"}
      </Link>
    </div>
  );
}

function LinkedInPanel({
  accounts,
}: {
  accounts: ProfileLinkedInAccount[];
}) {
  const slots = [accounts[0] ?? null, accounts[1] ?? null];
  return (
    <div className="section-note grid gap-4">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <BrandIcon name="linkedin" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            LinkedIn accounts
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            Connect up to two LinkedIn accounts for connection requests, DMs,
            and warm outreach. Limits stay visible before the agent sends.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        {slots.map((account, index) => (
          <LinkedInAccountSlot
            key={account?.id ?? `linkedin-slot-${index}`}
            account={account}
            label={index === 0 ? "First account" : "Second account"}
          />
        ))}
      </div>
    </div>
  );
}

function LinkedInAccountSlot({
  account,
  label,
}: {
  account: ProfileLinkedInAccount | null;
  label: string;
}) {
  return (
    <article className="grid gap-4 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon
            name={account?.status === "connected" ? "check_circle" : "sync_problem"}
            size={15}
          />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
              {label}
            </p>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
              Account and limits
            </span>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-3)]">
            {account
              ? `${account.display_name} - ${statusLabel(account.status)} - ${
                  account.daily_cap ?? "unlimited"
                } daily ceiling`
              : "Not connected - ready for LinkedIn outreach setup."}
          </p>
          {account?.last_error ? (
            <p className="mt-2 text-sm text-[#ffb4a8]">{account.last_error}</p>
          ) : null}
        </div>
      </div>
      <Link
        href="/api/auth/linkedin?return_to=%2Fdashboard%2Fprofile%23linkedin"
        prefetch={false}
        className={account ? "btn-quiet-sm w-fit" : "btn-solid-sm w-fit"}
      >
        <BrandIcon name="linkedin" size={14} />
        {account ? "Reconnect account" : "Connect account"}
      </Link>
    </article>
  );
}

function ContactQualityPanel({
  stats,
}: {
  stats: ProfileContactQuality;
}) {
  const coverage =
    stats.people > 0 ? `${Math.round((stats.reachable / stats.people) * 100)}%` : "0%";
  return (
    <div className="section-note grid gap-5">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name="verified" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Email and LinkedIn readiness
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            The agent resolves contacts from the graph first, enriches missing
            emails, verifies deliverability evidence, and avoids duplicate
            outreach before drafting.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <ProfileFact label="People" value={String(stats.people)} />
        <ProfileFact label="Reachable" value={String(stats.reachable)} />
        <ProfileFact label="Email handles" value={String(stats.emailHandles)} />
        <ProfileFact label="Verified emails" value={String(stats.verifiedEmails)} />
        <ProfileFact label="LinkedIn profiles" value={String(stats.linkedInProfiles)} />
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <PreferenceStatus
          icon="travel_explore"
          title="Email enrichment"
          detail="Graph cache, provider discovery, and verification run before email outreach."
          status={stats.emailHandles > 0 ? `${stats.emailHandles} found` : "Ready to run"}
        />
        <PreferenceStatus
          icon="linkedin"
          title="LinkedIn fallback"
          detail="LinkedIn profiles keep outreach available when an email is not ready."
          status={
            stats.linkedInProfiles > 0
              ? `${stats.linkedInProfiles} profiles`
              : "Connect account"
          }
        />
        <PreferenceStatus
          icon="hub"
          title="Duplicate protection"
          detail="Graph identity and recipient frequency caps keep the same contact from being worked twice."
          status={`${coverage} coverage`}
        />
      </div>

      <Link href="/dashboard/agent#verified-contacts" prefetch={false} className="btn-quiet-sm w-fit">
        <Icon name="arrow_forward" size={14} />
        Open Agent contacts
      </Link>
    </div>
  );
}

function PreferenceStatus({
  icon,
  title,
  detail,
  status,
}: {
  icon: string;
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <article className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={icon} size={15} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {title}
            </p>
            <span className="rounded-[8px] bg-[var(--color-pos-bg)] px-2 py-1 text-[11px] font-medium text-[var(--color-pos)]">
              {status}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
            {detail}
          </p>
        </div>
      </div>
    </article>
  );
}

function BlocklistPanel({
  stats,
  recent,
}: {
  stats: ProfileSuppressionStats;
  recent: ProfileSuppressionRow[];
}) {
  return (
    <div className="section-note grid gap-5">
      <div className="flex items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name="report" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Outreach protection
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            Bounces, unsubscribes, and do-not-contact events protect future
            outreach automatically.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <ProfileFact label="Protected" value={String(stats.total)} />
        <ProfileFact label="Bounces" value={String(stats.bounces)} />
        <ProfileFact label="Unsubscribed" value={String(stats.unsubscribes)} />
        <ProfileFact label="Do not contact" value={String(stats.doNotContact)} />
      </div>

      {recent.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-3 text-sm text-[var(--color-text-3)]">
          No blocklist events yet.
        </div>
      ) : (
        <div className="grid gap-2">
          {recent.map((row) => (
            <BlocklistRow key={row.id} row={row} />
          ))}
        </div>
      )}

      <Link href="/dashboard/agent#outreach" prefetch={false} className="btn-quiet-sm w-fit">
        <Icon name="arrow_forward" size={14} />
        Open Agent outreach
      </Link>
    </div>
  );
}

function BlocklistRow({ row }: { row: ProfileSuppressionRow }) {
  const content = (
    <article className="grid gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-3 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] bg-[var(--color-neg-bg)] px-2 py-1 text-[11px] font-medium text-[var(--color-neg)]">
            {suppressionLabel(row.kind)}
          </span>
          <span className="text-xs text-[var(--color-text-4)]">
            {freshWhen(row.recorded_at)}
          </span>
        </div>
        <p className="mt-2 truncate text-sm font-medium text-[var(--color-text-1)]">
          {row.counterparty_name ?? "Unknown contact"}
          {row.company_name ? ` at ${row.company_name}` : ""}
        </p>
      </div>
      <span className="text-xs font-medium text-[var(--color-accent)]">
        {row.conversation_id ? "Open Conversation" : "Protected"}
      </span>
    </article>
  );

  if (!row.conversation_id) return content;
  return (
    <Link href={`/dashboard/conversations/${row.conversation_id}`} prefetch={false}>
      {content}
    </Link>
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

function NoWorkspaceProfile() {
  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Profile"
        title="Create a workspace."
        description="Profile, channels, and limits attach to the active workspace."
      />
      <SurfaceSection title="Workspace">
        <form
          action={createWorkspaceAction}
          className="section-note grid gap-4 md:max-w-xl"
        >
          <input type="hidden" name="return_to" value="/dashboard/profile" />
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

function profileMode(
  settings: Record<string, unknown>,
  approvals: readonly string[],
): ProfileAutonomyMode {
  if (settings.autonomy_mode === "review_only") return "review_only";
  if (settings.autonomy_mode === "autonomous") return "autonomous";
  if (approvals.length === 0) return "autonomous";
  if (approvals.every((approval) => approval === "always"))
    return "review_only";
  if (approvals.every((approval) => approval === "none")) return "autonomous";
  return "custom";
}

function modeLabel(mode: ProfileAutonomyMode): string {
  if (mode === "review_only") return "Copilot review";
  if (mode === "custom") return "Mixed";
  return "Autopilot";
}

function profileWebsite(profile: ProductCompanyProfile | null): string {
  return (
    profile?.website_url ?? (profile?.domain ? `https://${profile.domain}` : "")
  );
}

function outlookMailbox(account: ProfileOutlookAccount): string {
  const mailbox = account.properties?.mailbox_email;
  return typeof mailbox === "string" && mailbox.trim()
    ? mailbox
    : account.display_name;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

function suppressionLabel(kind: string): string {
  if (kind === "bounce") return "Bounce";
  if (kind === "unsubscribe") return "Unsubscribe";
  if (kind === "do_not_contact") return "Do not contact";
  return kind.replace(/_/g, " ");
}

function freshWhen(value: Date): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function agentDisplayName(role: string): string {
  if (role === "sdr") return "Outbound agent";
  return "Agent";
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
