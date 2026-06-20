import Link from "next/link";
import type { ReactNode } from "react";
import type { Pool } from "pg";
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
import {
  buildOutputDestinations,
  type OutputDestination,
} from "@/core/product/output-destinations.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getRequestAuthIdentity } from "@/lib/auth";
import type { RequestAuthIdentity } from "@/lib/auth";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";
import {
  checkAgentSourcesAction,
  configureVisitorIntentSourceAction,
  configureActivationAction,
  configureCrmDestinationAction,
  createWorkspaceAction,
  editCompanyProfileAction,
  revokeMcpTokenAction,
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

interface ProfileSignalSetup {
  activeSources: number;
  watchedSources: number;
  sourceKinds: string[];
  qualifiedSignals7d: number;
}

interface ProfileMcpToken {
  token_hash: string;
  client_id: string | null;
  client_name: string | null;
  scope: string | null;
  expires_at: Date;
  last_used_at: Date | null;
  created_at: Date;
}

interface ProfileMcpActivity {
  id: string;
  occurred_at: Date;
  tool_name: string;
  status: string;
  client_id: string | null;
  latency_ms: number | null;
}

interface ProfileCrmAccount {
  id: string;
  display_name: string;
  status: string;
  last_error: unknown | null;
  properties: Record<string, unknown> | null;
  webhook_url: string | null;
  updated_at: Date;
}

interface ProfileVisitorIntentSource {
  id: string;
  name: string;
  enabled: boolean;
  provider: string | null;
  website_url: string | null;
  company_domain: string | null;
  created_at: Date;
}

interface ProfileState {
  settings: Record<string, unknown>;
  outlookAccount: ProfileOutlookAccount | null;
  linkedInAccount: ProfileLinkedInAccount | null;
  linkedInAccounts: ProfileLinkedInAccount[];
  crmAccount: ProfileCrmAccount | null;
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  approvals: string[];
  suppressionStats: ProfileSuppressionStats;
  recentSuppressions: ProfileSuppressionRow[];
  contactQuality: ProfileContactQuality;
  signalSetup: ProfileSignalSetup;
  mcpTokens: ProfileMcpToken[];
  mcpActivity: ProfileMcpActivity[];
  visitorIntentSource: ProfileVisitorIntentSource | null;
}

async function loadProfileMcpTokens(
  pool: Pool,
  userId: string,
): Promise<ProfileMcpToken[]> {
  try {
    const { rows } = await pool.query<ProfileMcpToken>(
      `select t.token_hash,
              t.client_id,
              c.client_name,
              t.scope,
              t.expires_at,
              t.last_used_at,
              t.created_at
         from mcp_oauth_tokens t
         left join mcp_oauth_clients c
           on c.client_id = t.client_id
        where t.user_id = $1
          and t.revoked_at is null
        order by coalesce(t.last_used_at, t.created_at) desc
        limit 10`,
      [userId],
    );
    return rows;
  } catch (error) {
    if (isMissingMcpOauthSchema(error)) return [];
    throw error;
  }
}

async function loadProfileMcpActivity(
  pool: Pool,
  workspaceId: string,
  userId: string,
): Promise<ProfileMcpActivity[]> {
  const { rows } = await pool.query<ProfileMcpActivity>(
    `select id,
            occurred_at,
            payload->>'tool_name' as tool_name,
            payload->>'status' as status,
            payload->>'client_id' as client_id,
            nullif(payload->>'latency_ms', '')::integer as latency_ms
       from events
      where workspace_id = $1
        and event_type = 'mcp.tool.called'
        and payload->>'user_id' = $2
      order by occurred_at desc
      limit 6`,
    [workspaceId, userId],
  );
  return rows;
}

function isMissingMcpOauthSchema(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "42P01" ||
      (error as { code?: unknown }).code === "42703")
  );
}

async function loadProfileState(workspaceId: string, userId: string): Promise<ProfileState> {
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
    signalSetup,
    mcpTokens,
    mcpActivity,
    crm,
    visitorIntent,
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
    pool.query<{
      active_sources: string;
      watched_sources: string;
      source_kinds: string[] | null;
      qualified_signals_7d: string;
    }>(
      `select
         (select count(*)::text
            from workspace_source_configs wsc
            join graph_sources gs
              on gs.workspace_id = wsc.workspace_id
             and gs.id = wsc.source_id
           where wsc.workspace_id = $1
             and wsc.enabled
             and gs.enabled) as active_sources,
         (select count(*)::text
            from workspace_source_configs wsc
            join graph_sources gs
              on gs.workspace_id = wsc.workspace_id
             and gs.id = wsc.source_id
           where wsc.workspace_id = $1) as watched_sources,
         array(
           select distinct coalesce(
                    nullif(gs.properties->>'signal_kind', ''),
                    gs.kind::text
                  )
             from workspace_source_configs wsc
             join graph_sources gs
               on gs.workspace_id = wsc.workspace_id
              and gs.id = wsc.source_id
            where wsc.workspace_id = $1
              and wsc.enabled
              and gs.enabled
            order by 1
         ) as source_kinds,
         (select count(*)::text
            from signals s
           where s.workspace_id = $1
             and s.status in ('matched','in_play')
             and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as qualified_signals_7d`,
      [workspaceId],
    ),
    loadProfileMcpTokens(pool, userId),
    loadProfileMcpActivity(pool, workspaceId, userId),
    pool.query<ProfileCrmAccount>(
      `select id,
              display_name,
              status::text as status,
              last_error,
              properties,
              credentials->>'webhook_url' as webhook_url,
              updated_at
         from channel_accounts
        where workspace_id = $1
          and kind = 'crm'
        order by case when status = 'connected' then 0 else 1 end,
                 updated_at desc,
                 created_at desc
        limit 1`,
      [workspaceId],
    ),
    pool.query<ProfileVisitorIntentSource>(
      `select gs.id::text as id,
              gs.name,
              gs.enabled,
              coalesce(gs.config->>'provider', gs.properties->>'provider') as provider,
              coalesce(gs.config->>'website_url', gs.properties->>'website_url') as website_url,
              coalesce(gs.config->>'company_domain', gs.properties->>'company_domain') as company_domain,
              gs.created_at
         from graph_sources gs
        where gs.workspace_id = $1
          and gs.kind = 'web_monitor'
          and coalesce(gs.config->>'provider', gs.properties->>'provider') in ('bombsell_script','rb2b','clearbit','factors','warmly','generic')
          and (
            gs.config->>'ingestion_contract' = 'bombsell_signal_v1'
            or gs.properties->>'ingestion_contract' = 'bombsell_signal_v1'
          )
        order by case when coalesce(gs.config->>'provider', gs.properties->>'provider') = 'bombsell_script' then 0 else 1 end,
                 gs.created_at desc
        limit 1`,
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
    crmAccount: crm.rows[0] ?? null,
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
    signalSetup: {
      activeSources: Number(signalSetup.rows[0]?.active_sources ?? 0),
      watchedSources: Number(signalSetup.rows[0]?.watched_sources ?? 0),
      sourceKinds: signalSetup.rows[0]?.source_kinds ?? [],
      qualifiedSignals7d: Number(signalSetup.rows[0]?.qualified_signals_7d ?? 0),
    },
    mcpTokens,
    mcpActivity,
    visitorIntentSource: visitorIntent.rows[0] ?? null,
  };
}

export default async function ProfilePage() {
  const active = await getActiveWorkspaceSessionForDashboard("profile");
  if (!active) return <NoWorkspaceProfile />;

  const pool = getPool();
  const productSession = verifiedProductWorkspaceSession({
    workspace_id: active.workspace.id,
    user_id: active.user_id,
  });
  const [profile, state, readiness] = await Promise.all([
    getProductCompanyProfile(pool, productSession),
    loadProfileState(active.workspace.id, active.user_id),
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
  const workspaceName = profileWorkspaceName(active.workspace.name, profile);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Profile"
        title={
          <>
            {profile?.company_name ?? workspaceName}
          </>
        }
        description="Paste the website, connect Outlook and LinkedIn, then let the agent run with the approval rail you choose."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat
              label="Workspace"
              value={workspaceName}
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

      <div id="profile">
        <SurfaceSection title="Company & ICP">
          <CompanyProfileForm profile={profile} />
          <IcpActivationForm
            rep={state.rep}
            icp={state.icp}
            outlookAccount={state.outlookAccount}
          />
        </SurfaceSection>
      </div>

      <span id="motion" className="block scroll-mt-28" aria-hidden="true" />
      <div id="channels">
        <SurfaceSection title="Channels">
          <div className="grid scroll-mt-28 gap-6 md:grid-cols-2">
            <div id="email">
              <OutlookPanel account={state.outlookAccount} />
            </div>

            <div id="linkedin">
              <LinkedInPanel accounts={state.linkedInAccounts} />
            </div>
          </div>
          <ChannelLimitForm
            rep={state.rep}
            icp={state.icp}
            outlookAccount={state.outlookAccount}
          />
        </SurfaceSection>
      </div>

      <div id="agent">
        <SurfaceSection title="Voice & autonomy">
          <MessageToneForm profile={profile} />
          <VoiceActivationForm
            rep={state.rep}
            icp={state.icp}
            outlookAccount={state.outlookAccount}
          />
          <WorkspaceAutonomyForm mode={mode} formMode={formMode} />
        </SurfaceSection>
      </div>

      <ProfileAdvancedDrawer
        identity={identity}
        workspaceName={workspaceName}
        workspaceSlug={active.workspace.slug}
        role={active.role}
        profile={profile}
        state={state}
        readiness={readiness}
      />
    </div>
  );
}

function WorkspaceAutonomyForm({
  mode,
  formMode,
}: {
  mode: ProfileAutonomyMode;
  formMode: "autonomous" | "review_only";
}) {
  return (
    <form
      action={updateWorkspaceAutonomyAction}
      className="section-note grid gap-5"
    >
      <input type="hidden" name="return_to" value="/dashboard/profile" />
      <div className="flex min-w-0 items-start gap-3">
        <span className="brief-note-icon shrink-0">
          <Icon name="task_alt" size={18} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Play review mode
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            Choose whether qualified outreach can move after checks pass or
            waits for approval.
          </p>
        </div>
      </div>
      <div id="autonomy" className="grid scroll-mt-28 gap-3 sm:grid-cols-2">
        <AutonomyOption
          value="autonomous"
          title="Auto-send after checks"
          description="Send after evals, caps, contact checks, and channel health pass."
          defaultChecked={formMode === "autonomous"}
        />
        <AutonomyOption
          value="review_only"
          title="Approve first"
          description="Prepare every move, then wait for a human approval before outreach."
          defaultChecked={formMode === "review_only"}
        />
      </div>
      {mode === "custom" ? (
        <p className="text-sm text-[var(--color-text-3)]">
          Current agent and outreach policies are mixed. Saving here applies one
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
  );
}

function ProfileAdvancedDrawer({
  identity,
  workspaceName,
  workspaceSlug,
  role,
  profile,
  state,
  readiness,
}: {
  identity: RequestAuthIdentity | null;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  profile: ProductCompanyProfile | null;
  state: ProfileState;
  readiness: ProductLaunchReadinessResult;
}) {
  return (
    <section id="tools" className="scroll-mt-28">
      <details className="section-note group grid gap-5">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 marker:hidden">
          <span className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
              <Icon name="account_tree" size={18} />
            </span>
            <span className="min-w-0">
              <span
                className="block text-[18px] font-semibold text-[var(--color-text-1)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Advanced
              </span>
              <span className="mt-1 block text-sm leading-6 text-[var(--color-text-3)]">
                Watchlists, quality gates, protection, long-tail profile
                fields, source IDs, webhooks, MCP, CRM, and workspace account
                details.
              </span>
            </span>
          </span>
          <span className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 text-xs font-medium text-[var(--color-text-2)]">
            <Icon
              name="expand_more"
              size={16}
              className="transition-transform group-open:rotate-180"
            />
            Advanced setup
          </span>
        </summary>
        <div className="mt-5 grid gap-6">
          <SurfaceSection title="Long-tail company fields">
            <AdvancedCompanyProfileForm profile={profile} />
          </SurfaceSection>
          <div id="contact-quality">
            <SurfaceSection title="Signal watchlist and contact-quality gates">
              <ProfileSignalBuilderPanel
                profile={profile}
                state={state}
                readiness={readiness}
              />
              <ContactQualityPanel stats={state.contactQuality} />
            </SurfaceSection>
          </div>
          <div id="blocklist">
            <SurfaceSection title="Blocklist / contact protection">
              <BlocklistPanel
                stats={state.suppressionStats}
                recent={state.recentSuppressions}
              />
            </SurfaceSection>
          </div>
          <SurfaceSection title="Workspace account">
            <AccountPanel
              identity={identity}
              workspaceName={workspaceName}
              workspaceSlug={workspaceSlug}
              role={role}
            />
          </SurfaceSection>
          <SurfaceSection title="Developer destinations and contracts">
            <IntegrationPanel
              profile={profile}
              state={state}
              readiness={readiness}
            />
          </SurfaceSection>
        </div>
      </details>
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
      href: "/dashboard/agent#qualified-signals",
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

function ProfileSignalBuilderPanel({
  profile,
  state,
  readiness,
}: {
  profile: ProductCompanyProfile | null;
  state: ProfileState;
  readiness: ProductLaunchReadinessResult;
}) {
  const roles = splitProfileTerms(profile?.target_titles);
  const markets = splitProfileTerms(profile?.target_markets);
  const keywords = splitProfileTerms(profile?.signal_keywords);
  const competitors = splitProfileTerms(profile?.competitor_watchlist);
  const linkedInBehaviors = profileLinkedInBehaviors(profile);
  const exclusions = splitProfileTerms(profile?.exclusion_rules);
  const signalCount =
    keywords.length +
    competitors.length +
    linkedInBehaviors.length +
    state.signalSetup.activeSources;
  const fitGate = state.icp
    ? Math.round(Number(state.icp.match_threshold) * 100)
    : 0;
  const readyGates = [
    roles.length > 0 || markets.length > 0,
    signalCount >= 5,
    state.signalSetup.activeSources > 0,
    profile?.auto_enrich_email_addresses !== false,
    profile?.prevent_team_contact_duplication !== false,
  ].filter(Boolean).length;
  const next = profileReadinessNextAction(readiness);
  return (
    <section id="signal-setup" className="section-note grid scroll-mt-28 gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
            Signal setup
          </p>
          <h2
            className="mt-1 text-[18px] font-semibold text-[var(--color-text-1)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Buyer fit, intent signals, and contact quality in one loop.
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-3)]">
            Define who matters, what LinkedIn or market behavior counts as
            timing evidence, and which quality gates must pass before outreach.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-[8px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] px-3 py-1 font-mono text-[12px] text-[var(--color-text-2)]">
            {readyGates}/5 gates ready
          </span>
          <Link href={next.href} prefetch={false} className="btn-solid-sm">
            <Icon name={next.icon} size={14} />
            {next.label}
          </Link>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <SignalSetupCard
          icon="person_search"
          title="Buyer filters"
          detail="Roles, markets, exclusions, and match gate decide which people can become qualified contacts."
          ready={roles.length > 0 || markets.length > 0}
          href="#profile"
          footer={`${fitGate || 60}% fit gate`}
        >
          <SetupChipGroup
            label="Roles"
            values={roles}
            empty="Add target roles"
          />
          <SetupChipGroup
            label="Markets"
            values={markets}
            empty="Add markets"
          />
          <SetupChipGroup
            label="Exclusions"
            values={exclusions}
            empty="No exclusions"
          />
        </SignalSetupCard>

        <SignalSetupCard
          icon="sensors"
          title="Intent signals"
          detail="Signal terms, competitors, and source categories tell the agent where fresh timing evidence should come from."
          ready={signalCount >= 5 && state.signalSetup.activeSources > 0}
          href="#profile"
          footer={`${state.signalSetup.qualifiedSignals7d} qualified this week`}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <ProfileFact label="Signal terms" value={String(signalCount)} />
            <ProfileFact
              label="Active sources"
              value={`${state.signalSetup.activeSources}/${state.signalSetup.watchedSources}`}
            />
            <ProfileFact
              label="Source types"
              value={String(state.signalSetup.sourceKinds.length)}
            />
          </div>
          <SetupChipGroup
            label="Watched terms"
            values={[...keywords, ...competitors]}
            empty="Add keywords or competitors"
          />
          <SetupChipGroup
            label="LinkedIn behavior"
            values={linkedInBehaviors}
            empty="Choose LinkedIn behaviors"
          />
          <SetupChipGroup
            label="Source categories"
            values={state.signalSetup.sourceKinds.map(sourceKindLabel)}
            empty="Run source setup"
          />
        </SignalSetupCard>

        <SignalSetupCard
          icon="verified"
          title="Quality gates"
          detail="Verified email, LinkedIn profiles, duplicate protection, and review mode keep outreach trustworthy."
          ready={state.contactQuality.reachable > 0}
          href="#contact-quality"
          footer={`${state.contactQuality.reachable} reachable contacts`}
        >
          <QualityGateRow
            icon="travel_explore"
            label="Auto-enrich email"
            ready={profile?.auto_enrich_email_addresses !== false}
          />
          <QualityGateRow
            icon="hub"
            label="Prevent duplicates"
            ready={profile?.prevent_team_contact_duplication !== false}
          />
          <QualityGateRow
            icon="mail"
            label="Verified email"
            ready={state.contactQuality.verifiedEmails > 0}
          />
          <QualityGateRow
            icon="linkedin"
            label="LinkedIn profile"
            ready={state.contactQuality.linkedInProfiles > 0}
          />
        </SignalSetupCard>
      </div>

      <div className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 md:grid-cols-[1fr_auto] md:items-center">
        <p className="text-sm leading-6 text-[var(--color-text-3)]">
          Keep at least five strong signal inputs across keywords, competitors,
          and active sources. Bombsell turns them into qualified contacts,
          judged drafts, sent emails or LinkedIn DMs, then reply learning.
        </p>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <form action={checkAgentSourcesAction}>
            <input type="hidden" name="return_to" value="/dashboard/profile#signal-setup" />
            <input type="hidden" name="limit" value="25" />
            <PendingSubmitButton
              className="btn-solid w-fit"
              icon="sync_alt"
              pendingLabel="Checking sources"
            >
              Check sources
            </PendingSubmitButton>
          </form>
          <Link
            href="/dashboard/agent#qualified-signals"
            prefetch={false}
            className="btn-quiet-sm w-fit"
          >
            <Icon name="arrow_forward" size={14} />
            Open Agent
          </Link>
        </div>
      </div>
    </section>
  );
}

function SignalSetupCard({
  icon,
  title,
  detail,
  ready,
  href,
  footer,
  children,
}: {
  icon: string;
  title: string;
  detail: string;
  ready: boolean;
  href: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <article className="grid min-h-[360px] gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span
          className={
            "grid size-9 shrink-0 place-items-center rounded-[8px] " +
            (ready
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
          }
        >
          <Icon name={icon} size={17} />
        </span>
        <StatusPill ready={ready} />
      </div>
      <div>
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </p>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
          {detail}
        </p>
      </div>
      <div className="grid content-start gap-3">{children}</div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-[var(--color-line-1)] pt-3">
        <span className="text-xs text-[var(--color-text-3)]">{footer}</span>
        <Link href={href} prefetch={false} className="btn-quiet-sm">
          <Icon name="edit_note" size={14} />
          Tune
        </Link>
      </div>
    </article>
  );
}

function SetupChipGroup({
  label,
  values,
  empty,
}: {
  label: string;
  values: string[];
  empty: string;
}) {
  const visible = uniqueStrings(values).slice(0, 5);
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-4)]">
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.length > 0 ? (
          <>
            {visible.map((value) => (
              <span
                key={value}
                className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-2)]"
              >
                {value}
              </span>
            ))}
            {values.length > visible.length ? (
              <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
                +{values.length - visible.length}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-[var(--color-text-4)]">{empty}</span>
        )}
      </div>
    </div>
  );
}

function QualityGateRow({
  icon,
  label,
  ready,
}: {
  icon: string;
  label: string;
  ready: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--color-text-2)]">
        <Icon name={icon} size={14} />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={
          "size-2 shrink-0 rounded-full " +
          (ready ? "bg-[var(--color-pos)]" : "bg-[var(--color-text-4)]")
        }
      />
    </div>
  );
}

function profileLinkedInBehaviors(
  profile: ProductCompanyProfile | null,
): string[] {
  return splitProfileTerms(profile?.linkedin_signal_behaviors);
}

function splitProfileTerms(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sourceKindLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "hn") return "HN";
  if (normalized === "rss") return "RSS";
  if (normalized === "gdelt") return "GDELT";

  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  values.forEach((value) => {
    const clean = value.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  });
  return out;
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

function IntegrationPanel({
  profile,
  state,
  readiness,
}: {
  profile: ProductCompanyProfile | null;
  state: ProfileState;
  readiness: ProductLaunchReadinessResult;
}) {
  const destinations = buildOutputDestinations({
    email_connected: state.outlookAccount?.status === "connected",
    linkedin_connected: state.linkedInAccount?.status === "connected",
    crm_connected: state.crmAccount?.status === "connected",
    launch_ready: readiness.launch_ready,
  });
  const activeDestinations = destinations.filter(
    (destination) => destination.status !== "planned",
  );
  const plannedDestinations = destinations.filter(
    (destination) => destination.status === "planned",
  );
  return (
    <div className="section-note grid gap-5">
      <div>
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          Where qualified work can go
        </p>
        <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
          Bombsell routes quality signals into native outreach first, accepts
          visitor-intent and signal webhooks, then opens the same graph-backed
          tools to agent and CRM handoff surfaces. Native CRM OAuth and
          volume-tool sync stay explicit until those destinations are wired.
        </p>
      </div>

      <div className="grid gap-3">
        {activeDestinations.map((destination) => (
          <Link
            key={destination.key}
            href={destination.href ?? "#tools"}
            prefetch={false}
            className="group rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]"
          >
            <span className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
              <span className="flex min-w-0 items-start gap-3">
                <span
                  className={
                    "grid size-9 shrink-0 place-items-center rounded-[8px] " +
                    (destinationReady(destination)
                      ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                      : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
                  }
                >
                  {destinationIcon(destination)}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-[var(--color-text-1)]">
                      {destination.title}
                    </span>
                    <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
                      {destination.category}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-[var(--color-text-3)]">
                    {destination.detail}
                  </span>
                  {destinationCode(destination).length > 0 ? (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {destinationCode(destination).map((code) => (
                        <span
                          key={code}
                          className="inline-block rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-2)]"
                        >
                          {code}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                <span
                  className={
                    "rounded-[8px] px-2.5 py-1 text-[11px] font-medium " +
                    (destinationReady(destination)
                      ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                      : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
                  }
                >
                  {destinationStatusLabel(destination)}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent)]">
                  {destinationAction(destination)}
                  <Icon
                    name="arrow_forward"
                    size={13}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </span>
            </span>
          </Link>
        ))}
      </div>

      <McpAccessPanel
        tokens={state.mcpTokens}
        activity={state.mcpActivity}
      />

      <VisitorIntentSetupPanel
        profile={profile}
        source={state.visitorIntentSource}
      />

      <CrmHandoffSetupPanel account={state.crmAccount} />

      <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Next destination classes
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
              These match the output pipes users expect, but should ship as real
              evented integrations rather than decorative install buttons.
            </p>
          </div>
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
            Planned
          </span>
        </div>
        <div className="mt-4 grid gap-2">
          {plannedDestinations.map((destination) => (
            <div
              key={destination.key}
              className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-3"
            >
              <span className="flex items-start gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-0)] text-[var(--color-text-2)]">
                  {destinationIcon(destination)}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[var(--color-text-1)]">
                    {destination.title}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-text-3)]">
                    {destination.detail}
                  </span>
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function destinationReady(destination: OutputDestination): boolean {
  return (
    destination.status === "connected" || destination.status === "available"
  );
}

function destinationStatusLabel(destination: OutputDestination): string {
  if (destination.status === "connected") return "Connected";
  if (destination.status === "available") return "Available";
  if (destination.status === "planned") return "Planned";
  return "Blocked";
}

function destinationAction(destination: OutputDestination): string {
  if (destination.key === "outlook") {
    return destination.status === "connected"
      ? "Manage Outlook"
      : "Connect Outlook";
  }
  if (destination.key === "linkedin") {
    return destination.status === "connected"
      ? "Manage LinkedIn"
      : "Connect LinkedIn";
  }
  if (destination.key === "claude-code") return "Use Bombsell in Claude Code";
  if (destination.key === "signal-webhook") return "View route";
  if (destination.key === "visitor-deanonymization") return "Set up visitor ID";
  if (destination.key === "crm-sync") return "Set up CRM handoff";
  return destinationStatusLabel(destination);
}

function destinationCode(destination: OutputDestination): string[] {
  if (destination.tools.length > 0) return destination.tools;
  if (destination.href?.startsWith("/api/")) return [destination.href];
  return [];
}

function destinationIcon(destination: OutputDestination): ReactNode {
  if (destination.key === "outlook") {
    return <BrandIcon name="microsoft" size={16} />;
  }
  if (destination.key === "linkedin") {
    return <BrandIcon name="linkedin" size={16} />;
  }
  if (destination.key === "signal-webhook") {
    return <Icon name="webhook" size={16} />;
  }
  if (destination.key === "visitor-deanonymization") {
    return <Icon name="radar" size={16} />;
  }
  if (destination.key === "crm-sync") {
    return <Icon name="corporate_fare" size={16} />;
  }
  if (destination.key === "outreach-tool-sync") {
    return <Icon name="send" size={16} />;
  }
  if (destination.key === "team-alerts") return <Icon name="hub" size={16} />;
  return <Icon name="account_tree" size={16} />;
}

function VisitorIntentSetupPanel({
  profile,
  source,
}: {
  profile: ProductCompanyProfile | null;
  source: ProfileVisitorIntentSource | null;
}) {
  const sourceId = source?.id ?? "00000000-0000-4000-8000-000000000123";
  const websiteUrl = profile?.website_url ?? "";
  const companyDomain =
    source?.company_domain ?? profile?.domain ?? domainFromWebsite(profile?.website_url) ?? "";
  const companyName = profile?.company_name ?? "";
  const scriptHost = "https://www.bombsell.com";
  const scriptSnippet = `<script
  src="${scriptHost}/visitor.js"
  data-source-id="${sourceId}"${
    companyDomain ? `\n  data-company-domain="${companyDomain}"` : ""
  }
  data-marketing-allowed="true"
  async></script>`;
  return (
    <div
      id="visitor-intent"
      className="scroll-mt-28 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Visitor intent setup
          </p>
          <p className="mt-1 max-w-[74ch] text-xs leading-5 text-[var(--color-text-3)]">
            Install Bombsell's visitor script or connect RB2B, Clearbit,
            Factors, Warmly, or your own website identity feed. Bombsell turns
            consented firmographics, page paths, dwell time, repeat visits, and
            identity proof into the same Signal scoring, contact resolution,
            judged outreach, and CRM handoff path.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-pos-bg)] px-2.5 py-1 text-xs text-[var(--color-pos)]">
          {source ? "Source ready" : "Available"}
        </span>
      </div>
      {!source ? (
        <form
          action={configureVisitorIntentSourceAction}
          className="mt-4 flex flex-wrap items-end gap-3 rounded-[8px] bg-[var(--color-ink-1)] p-3"
        >
          <input type="hidden" name="return_to" value="/dashboard/profile#visitor-intent" />
          <input type="hidden" name="visitor_website_url" value={websiteUrl} />
          <input type="hidden" name="visitor_company_domain" value={companyDomain} />
          <input type="hidden" name="visitor_company_name" value={companyName} />
          <span className="min-w-[220px] flex-1 text-xs leading-5 text-[var(--color-text-3)]">
            Create the source first, then install the generated snippet on the
            website. Bombsell will use the workspace profile domain to keep the
            public collector origin-aware.
          </span>
          <PendingSubmitButton
            className="btn-solid-sm"
            icon="sensors"
            pendingLabel="Creating source"
          >
            Create visitor source
          </PendingSubmitButton>
        </form>
      ) : (
        <div className="mt-4 grid gap-2 rounded-[8px] bg-[var(--color-ink-1)] p-3 sm:grid-cols-3">
          <ProfileFact label="Source ID" value={source.id} />
          <ProfileFact label="Provider" value={source.provider ?? "bombsell_script"} />
          <ProfileFact
            label="Origin"
            value={source.website_url ?? source.company_domain ?? "Any"}
          />
        </div>
      )}
      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-2 rounded-[8px] bg-[var(--color-ink-1)] p-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
            <Icon name="article" size={14} />
            Website script
          </span>
          <code className="overflow-x-auto whitespace-pre rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-[11px] leading-5 text-[var(--color-text-2)]">
{scriptSnippet}
          </code>
          <div className="grid gap-2 sm:grid-cols-2">
            <ProfileFact label="Collector" value="/api/collect/visitors" />
            <ProfileFact label="Identity" value="window.bombsell('identify')" />
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-3)]">
            Browser collection never exposes the webhook secret. Anonymous or
            opted-out visits are skipped until a consented company, email, or
            LinkedIn identity is present.
          </p>
        </div>
        <div className="grid gap-2 rounded-[8px] bg-[var(--color-ink-1)] p-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
            <Icon name="webhook" size={14} />
            Provider webhook
          </span>
          <code className="overflow-x-auto rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-2)]">
            POST /api/webhooks/visitors
          </code>
          <div className="grid gap-2 sm:grid-cols-2">
            <ProfileFact label="Auth" value="Bearer or HMAC" />
            <ProfileFact label="Secret" value="SIGNAL_WEBHOOK_SECRET" />
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-3)]">
            Use for RB2B, Clearbit, Factors, Warmly, or server-side identity
            providers that can sign visitor events before Bombsell scores,
            dedupes, and routes them through the workspace graph.
          </p>
        </div>
      </div>
      <div className="mt-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
          <Icon name="sensors" size={14} />
          Source setup
        </span>
        <code className="mt-2 block overflow-x-auto rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-2)]">
          product.source.configure adapter=webhook provider=bombsell_script source_id=${sourceId}
        </code>
        <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
          Use this source_id in either the browser script or signed provider
          payload. Website URL/domain lets the public collector reject
          mismatched origins while still keeping the source_id safe to install.
        </p>
      </div>
      <div className="mt-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
          <Icon name="radar" size={14} />
          Minimal visitor payload
        </span>
        <code className="mt-2 block overflow-x-auto whitespace-pre rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-[11px] leading-5 text-[var(--color-text-2)]">
{`{
  "source_id": "00000000-0000-4000-8000-000000000123",
  "external_id": "visitor-event-id",
  "company_domain": "example.com",
  "industry": "Software",
  "headcount": "51-200",
  "page_url": "https://example.com/pricing",
  "intent_score": 0.82,
  "dwell_time_seconds": 93,
  "scroll_depth": 0.78,
  "repeat_visits": 3,
  "consent": {
    "marketing_allowed": true,
    "do_not_track": false,
    "record_id": "consent-record-id"
  }
}`}
        </code>
      </div>
    </div>
  );
}

function CrmHandoffSetupPanel({ account }: { account: ProfileCrmAccount | null }) {
  const provider = crmProviderFromAccount(account);
  const syncMode = crmSyncModeFromAccount(account);
  const deliveryStatus = crmWebhookDeliveryStatus(account);
  return (
    <div
      id="crm-sync"
      className="scroll-mt-28 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            CRM handoff setup
          </p>
          <p className="mt-1 max-w-[74ch] text-xs leading-5 text-[var(--color-text-3)]">
            Send qualified contacts and their signal proof into HubSpot,
            Salesforce, Pipedrive, Attio, Folk, Clay, or a custom webhook.
            Bombsell queues CRM-ready packages with intent score, verified
            email or LinkedIn profile, judged outreach, replies, and meetings.
            Delivery status appears here after each webhook handoff.
          </p>
        </div>
        <span
          className={
            "rounded-[8px] px-2.5 py-1 text-xs " +
            (account?.status === "connected"
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
          }
        >
          {account?.status === "connected" ? "Connected" : "Available"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="grid content-start gap-3 rounded-[8px] bg-[var(--color-ink-1)] p-3">
          <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
            <Icon name="corporate_fare" size={14} />
            Current handoff
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            <ProfileFact
              label="Destination"
              value={account?.display_name ?? "Not configured"}
            />
            <ProfileFact
              label="Sync mode"
              value={crmSyncModeLabel(syncMode)}
            />
            <ProfileFact label="Provider" value={crmProviderLabel(provider)} />
            <ProfileFact
              label="Webhook"
              value={crmWebhookConfigured(account) ? "Configured" : "Optional"}
            />
            <ProfileFact label="Delivery" value={deliveryStatus} />
            <ProfileFact
              label="Last payload"
              value={crmLastHandoffLabel(account)}
            />
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-3)]">
            Use `bombsell.crm_handoff.queue` for qualified-contact handoff now.
            If a webhook URL is configured, Bombsell posts the proof package and
            records delivery or failure as typed CRM handoff events.
          </p>
        </div>

        <form
          action={configureCrmDestinationAction}
          className="grid gap-3 rounded-[8px] bg-[var(--color-ink-1)] p-3"
        >
          <input type="hidden" name="return_to" value="/dashboard/profile#crm-sync" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-xs font-medium text-[var(--color-text-2)]">
              CRM
              <select
                name="crm_provider"
                defaultValue={provider}
                className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm text-[var(--color-text-1)] outline-none"
              >
                <option value="hubspot">HubSpot</option>
                <option value="salesforce">Salesforce</option>
                <option value="pipedrive">Pipedrive</option>
                <option value="attio">Attio</option>
                <option value="folk">Folk</option>
                <option value="clay">Clay</option>
                <option value="custom">Custom webhook</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-xs font-medium text-[var(--color-text-2)]">
              Label
              <input
                name="crm_display_name"
                defaultValue={account?.display_name ?? ""}
                placeholder="Revenue CRM"
                className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm text-[var(--color-text-1)] outline-none"
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-medium text-[var(--color-text-2)]">
            Webhook URL
            <input
              name="crm_webhook_url"
              type="url"
              defaultValue={account?.webhook_url ?? ""}
              placeholder="https://hooks.example.com/bombsell/crm"
              className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm text-[var(--color-text-1)] outline-none"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-[var(--color-text-2)]">
            What to sync
            <select
              name="crm_sync_mode"
              defaultValue={syncMode}
              className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm text-[var(--color-text-1)] outline-none"
            >
              <option value="qualified_contacts">Qualified contacts</option>
              <option value="qualified_and_sent">Contacts and sent outreach</option>
              <option value="full_loop">Contacts, outreach, replies, meetings</option>
            </select>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2 text-xs text-[var(--color-text-2)]">
              <input
                name="crm_include_sent_outreach"
                type="checkbox"
                defaultChecked={syncMode !== "qualified_contacts"}
                className="mt-0.5"
              />
              Include sent outreach proof
            </label>
            <label className="flex items-start gap-2 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2 text-xs text-[var(--color-text-2)]">
              <input
                name="crm_include_replies_meetings"
                type="checkbox"
                defaultChecked={syncMode === "full_loop"}
                className="mt-0.5"
              />
              Include replies and meetings
            </label>
          </div>
          <PendingSubmitButton
            className="btn-solid w-fit"
            icon="check"
            pendingLabel="Saving CRM"
          >
            Save CRM handoff
          </PendingSubmitButton>
        </form>
      </div>

      <div className="mt-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
        <span className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
          <Icon name="account_tree" size={14} />
          Handoff contract
        </span>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            "bombsell.signals.list_qualified",
            "bombsell.contacts.list_lanes",
            "bombsell.crm_handoff.queue",
            "crm.destination.configured",
            "crm.handoff.webhook.delivered",
            "crm.handoff.webhook.failed",
          ].map((item) => (
            <span
              key={item}
              className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-2)]"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function crmProviderFromAccount(account: ProfileCrmAccount | null): string {
  const provider = account?.properties?.provider;
  return typeof provider === "string" && provider ? provider : "hubspot";
}

function crmSyncModeFromAccount(account: ProfileCrmAccount | null): string {
  const mode = account?.properties?.sync_mode;
  return mode === "full_loop" || mode === "qualified_and_sent"
    ? mode
    : "qualified_contacts";
}

function crmWebhookConfigured(account: ProfileCrmAccount | null): boolean {
  return account?.properties?.webhook_configured === true;
}

function crmWebhookDeliveryStatus(account: ProfileCrmAccount | null): string {
  const status = stringProperty(account?.properties, "last_webhook_status");
  if (status === "delivered") {
    const code = stringProperty(account?.properties, "last_webhook_status_code");
    return code ? `Delivered (${code})` : "Delivered";
  }
  if (status === "failed") {
    const code = stringProperty(account?.properties, "last_webhook_status_code");
    return code ? `Failed (${code})` : "Failed";
  }
  return crmWebhookConfigured(account) ? "Ready" : "Not configured";
}

function crmLastHandoffLabel(account: ProfileCrmAccount | null): string {
  const count = stringProperty(account?.properties, "last_handoff_contact_count");
  const status = stringProperty(account?.properties, "last_webhook_status");
  if (count && status) return `${count} contacts, ${status}`;
  if (count) return `${count} contacts queued`;
  return "None yet";
}

function stringProperty(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = record?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function domainFromWebsite(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function crmProviderLabel(provider: string): string {
  const labels: Record<string, string> = {
    hubspot: "HubSpot",
    salesforce: "Salesforce",
    pipedrive: "Pipedrive",
    attio: "Attio",
    folk: "Folk",
    clay: "Clay",
    custom: "Custom webhook",
  };
  return labels[provider] ?? provider.replace(/_/g, " ");
}

function crmSyncModeLabel(mode: string): string {
  if (mode === "full_loop") return "Full loop";
  if (mode === "qualified_and_sent") return "Contacts + sent proof";
  return "Qualified contacts";
}

function McpAccessPanel({
  tokens,
  activity,
}: {
  tokens: ProfileMcpToken[];
  activity: ProfileMcpActivity[];
}) {
  const activeCount = tokens.filter((token) => new Date(token.expires_at).getTime() > Date.now()).length;
  return (
    <div
      id="claude-code"
      className="scroll-mt-28 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Claude Code access
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
            Browser-authorized MCP sessions can inspect Brief, Profile,
            qualified signals, sent outreach, drafts, approvals, and reply
            learning through the same gated Bombsell tools.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
          {activeCount} active
        </span>
      </div>

      {tokens.length > 0 ? (
        <div className="mt-4 grid gap-2">
          {tokens.map((token) => (
            <div
              key={token.token_hash}
              className="grid gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--color-text-1)]">
                    {token.client_name?.trim() || "Claude Code MCP client"}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-[var(--color-text-4)]">
                    token {token.token_hash.slice(0, 10)}...
                  </p>
                </div>
                <form action={revokeMcpTokenAction}>
                  <input type="hidden" name="return_to" value="/dashboard/profile#tools" />
                  <input type="hidden" name="token_hash" value={token.token_hash} />
                  <PendingSubmitButton
                    className="btn-quiet-sm"
                    icon="block"
                    pendingLabel="Revoking"
                  >
                    Revoke
                  </PendingSubmitButton>
                </form>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <ProfileFact
                  label="Last used"
                  value={token.last_used_at ? freshWhen(token.last_used_at) : "Never"}
                />
                <ProfileFact label="Created" value={freshWhen(token.created_at)} />
                <ProfileFact label="Expires" value={expiresWhen(token.expires_at)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {mcpScopeList(token.scope).map((scope) => (
                  <span
                    key={scope}
                    className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-2 py-1 font-mono text-[10.5px] text-[var(--color-text-3)]"
                  >
                    {scope}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-[8px] border border-dashed border-[var(--color-line-2)] bg-[var(--color-ink-1)] p-3">
          <p className="text-xs leading-5 text-[var(--color-text-3)]">
            No Claude Code sessions yet. Install the Bombsell plugin and connect
            through the browser consent flow to create the first MCP session.
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span>
            <span className="block text-xs font-semibold text-[var(--color-text-1)]">
              Direct MCP setup
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--color-text-3)]">
              Add Bombsell to Claude Code today, then authenticate from the MCP
              panel. The plugin adds guided /bombsell skills after marketplace
              dogfood.
            </span>
          </span>
          <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
            OAuth
          </span>
        </div>
        <code className="overflow-x-auto rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-2)]">
          claude mcp add --transport http bombsell https://www.bombsell.com/api/mcp
        </code>
        <div className="grid gap-2 sm:grid-cols-3">
          <McpSetupStep icon="dashboard" label="Brief" detail="24h and 7d signal, send, reply, and meeting metrics." />
          <McpSetupStep icon="verified" label="Profile" detail="Buyer fit, channels, source setup, and contact quality." />
          <McpSetupStep icon="auto_awesome" label="Agent" detail="Qualified signals, verified contacts, drafts, approvals, and learning." />
        </div>
      </div>

      <div className="mt-4 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-[var(--color-text-1)]">
            Recent MCP activity
          </p>
          <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
            Evented audit
          </span>
        </div>
        {activity.length > 0 ? (
          <div className="mt-3 grid gap-2">
            {activity.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[11px] text-[var(--color-text-2)]">
                    {item.tool_name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-[var(--color-text-4)]">
                    {freshWhen(item.occurred_at)}
                    {item.latency_ms == null ? "" : ` · ${item.latency_ms}ms`}
                  </span>
                </span>
                <span
                  className={
                    "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
                    (item.status === "completed"
                      ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                      : "bg-[var(--color-neg-bg)] text-[var(--color-neg)]")
                  }
                >
                  {item.status || "recorded"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
            No external agent calls recorded yet. Tool calls from Claude Code
            will appear here after the plugin starts using Bombsell.
          </p>
        )}
      </div>
    </div>
  );
}

function McpSetupStep({
  icon,
  label,
  detail,
}: {
  icon: string;
  label: string;
  detail: string;
}) {
  return (
    <span className="flex items-start gap-2 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2">
      <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-accent)]">
        <Icon name={icon} size={14} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-[var(--color-text-1)]">
          {label}
        </span>
        <span className="mt-0.5 block text-[11px] leading-4 text-[var(--color-text-4)]">
          {detail}
        </span>
      </span>
    </span>
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
      <CompanyProfileHiddenFields
        profile={profile}
        omit={[
          "company_name",
          "website_url",
          "description",
          "target_titles",
          "value_proposition",
          "signal_keywords",
        ]}
      />
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
      </div>
      <TextArea
        name="description"
        label="What you sell"
        defaultValue={profile?.description ?? ""}
        rows={3}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <TextArea
          name="target_titles"
          label="Who you target / buyer roles"
          defaultValue={profile?.target_titles ?? ""}
          rows={3}
        />
        <TextArea
          name="value_proposition"
          label="Pitch / value prop"
          defaultValue={profile?.value_proposition ?? ""}
          rows={3}
        />
      </div>
      <TextArea
        name="signal_keywords"
        label="Key signal keywords"
        defaultValue={profile?.signal_keywords ?? ""}
        rows={3}
      />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="save"
        pendingLabel="Saving profile"
      >
        Save Company & ICP
      </PendingSubmitButton>
    </form>
  );
}

function AdvancedCompanyProfileForm({
  profile,
}: {
  profile: ProductCompanyProfile | null;
}) {
  return (
    <form action={editCompanyProfileAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/profile#tools" />
      <CompanyProfileHiddenFields
        profile={profile}
        omit={[
          "industry",
          "company_size",
          "customer_pain_points",
          "target_markets",
          "key_features",
          "social_proof",
          "competitor_watchlist",
          "linkedin_signal_behaviors",
          "exclusion_rules",
          "preferred_language",
          "outreach_goal",
          "linkedin_company_url",
          "auto_enrich_email_addresses",
          "prevent_team_contact_duplication",
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          name="industry"
          label="Industry"
          defaultValue={profile?.industry ?? ""}
        />
        <Select
          name="company_size"
          label="Company size"
          defaultValue={profile?.company_size ?? ""}
          options={companySizeOptions()}
        />
      </div>
      <TextArea
        name="customer_pain_points"
        label="Customer pain points"
        defaultValue={profile?.customer_pain_points ?? ""}
        rows={3}
      />
      <TextArea
        name="target_markets"
        label="Target markets"
        defaultValue={profile?.target_markets ?? ""}
        rows={4}
      />
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
          name="competitor_watchlist"
          label="Competitors to watch"
          defaultValue={profile?.competitor_watchlist ?? ""}
          rows={4}
        />
        <TextArea
          name="linkedin_signal_behaviors"
          label="LinkedIn behavior to watch"
          defaultValue={linkedinSignalBehaviorDefault(profile)}
          rows={4}
        />
      </div>
      <TextArea
        name="exclusion_rules"
        label="Do not contact"
        defaultValue={profile?.exclusion_rules ?? ""}
        rows={3}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          name="preferred_language"
          label="Preferred language"
          defaultValue={profile?.preferred_language ?? "English (US)"}
          options={preferredLanguageOptions()}
        />
        <Select
          name="outreach_goal"
          label="Outreach goal"
          defaultValue={profile?.outreach_goal ?? "conversations"}
          options={outreachGoalOptions()}
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
        pendingLabel="Saving advanced profile"
      >
        Save advanced profile
      </PendingSubmitButton>
    </form>
  );
}

function CompanyProfileHiddenFields({
  profile,
  omit = [],
}: {
  profile: ProductCompanyProfile | null;
  omit?: string[];
}) {
  const omitted = new Set(omit);
  const fields: Array<[string, string]> = [
    ["company_name", profile?.company_name ?? ""],
    ["website_url", profileWebsite(profile)],
    ["industry", profile?.industry ?? ""],
    ["company_size", profile?.company_size ?? ""],
    ["description", profile?.description ?? ""],
    ["value_proposition", profile?.value_proposition ?? ""],
    ["customer_pain_points", profile?.customer_pain_points ?? ""],
    ["target_titles", profile?.target_titles ?? ""],
    ["target_markets", profile?.target_markets ?? ""],
    ["key_features", profile?.key_features ?? ""],
    ["social_proof", profile?.social_proof ?? ""],
    ["signal_keywords", profile?.signal_keywords ?? ""],
    ["competitor_watchlist", profile?.competitor_watchlist ?? ""],
    ["linkedin_signal_behaviors", linkedinSignalBehaviorDefault(profile)],
    ["exclusion_rules", profile?.exclusion_rules ?? ""],
    ["preferred_language", profile?.preferred_language ?? "English (US)"],
    ["outreach_goal", profile?.outreach_goal ?? "conversations"],
    ["message_tone", profile?.message_tone ?? "professional"],
    ["linkedin_company_url", profile?.linkedin_company_url ?? ""],
  ];
  const autoEnrich = profile?.auto_enrich_email_addresses ?? true;
  const preventDupes = profile?.prevent_team_contact_duplication ?? true;
  return (
    <>
      {fields
        .filter(([name]) => !omitted.has(name))
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      {!omitted.has("auto_enrich_email_addresses") && autoEnrich ? (
        <input type="hidden" name="auto_enrich_email_addresses" value="on" />
      ) : null}
      {!omitted.has("prevent_team_contact_duplication") && preventDupes ? (
        <input type="hidden" name="prevent_team_contact_duplication" value="on" />
      ) : null}
    </>
  );
}

function ActivationHiddenFields({
  rep,
  icp,
  outlookAccount,
  omit = [],
}: {
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  outlookAccount: ProfileOutlookAccount | null;
  omit?: string[];
}) {
  const omitted = new Set(omit);
  const fields: Array<[string, string]> = [
    ["icp_description", profileIcpDescription(icp)],
    ["rep_voice", profileRepVoice(rep)],
    ["rep_story", profileRepStory(rep)],
    ["daily_cap", String(profileDailyCap(rep, outlookAccount))],
    ["approval", profileApproval(rep)],
    ["icp_name", icp?.name ?? "Default audience"],
    ["signal_kind", "hiring"],
    ["match_threshold", icp ? Number(icp.match_threshold).toFixed(2) : "0.60"],
  ];
  return (
    <>
      {fields
        .filter(([name]) => !omitted.has(name))
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      {rep ? (
        <input type="hidden" name="rep_id" value={rep.id} />
      ) : (
        <input type="hidden" name="rep_name" value="Outbound agent" />
      )}
    </>
  );
}

function companySizeOptions(): Array<[string, string]> {
  return [
    ["", "Unspecified"],
    ["1-10", "1-10 employees"],
    ["11-50", "11-50 employees"],
    ["51-200", "51-200 employees"],
    ["201-500", "201-500 employees"],
    ["501-1000", "501-1000 employees"],
    ["1001-5000", "1001-5000 employees"],
    ["5001-10000", "5001-10000 employees"],
    ["10000+", "10000+ employees"],
  ];
}

function preferredLanguageOptions(): Array<[string, string]> {
  return [
    ["English (US)", "English (US)"],
    ["English (UK)", "English (UK)"],
    ["Spanish", "Spanish"],
    ["French", "French"],
    ["German", "German"],
  ];
}

function outreachGoalOptions(): Array<[string, string]> {
  return [
    ["conversations", "Start conversations"],
    ["demos", "Book qualified demos"],
  ];
}

function messageToneOptions(): Array<[string, string]> {
  return [
    ["professional", "Professional"],
    ["conversational", "Conversational"],
    ["direct", "Direct"],
  ];
}

function approvalOptions(): Array<[string, string]> {
  return [
    ["none", "Autonomous after checks"],
    ["always", "Review every move"],
    ["approve_first", "Review the first move"],
    ["research_only", "Research only"],
  ];
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

function IcpActivationForm({
  rep,
  icp,
  outlookAccount,
}: {
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  outlookAccount: ProfileOutlookAccount | null;
}) {
  return (
    <form action={configureActivationAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/profile#profile" />
      <ActivationHiddenFields
        rep={rep}
        icp={icp}
        outlookAccount={outlookAccount}
        omit={["icp_description"]}
      />
      <TextArea
        name="icp_description"
        label="ICP notes"
        rows={3}
        defaultValue={
          icp?.description ??
          "Companies showing fresh hiring intent around GTM, operations, or revenue roles."
        }
      />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="check"
        pendingLabel="Saving ICP"
      >
        Save ICP
      </PendingSubmitButton>
    </form>
  );
}

function ChannelLimitForm({
  rep,
  icp,
  outlookAccount,
}: {
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  outlookAccount: ProfileOutlookAccount | null;
}) {
  const dailyCap = profileDailyCap(rep, outlookAccount);
  return (
    <form
      action={configureActivationAction}
      className="section-note grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
    >
      <input type="hidden" name="return_to" value="/dashboard/profile#channels" />
      <ActivationHiddenFields
        rep={rep}
        icp={icp}
        outlookAccount={outlookAccount}
        omit={["daily_cap"]}
      />
      <Field
        name="daily_cap"
        label="Daily send limit"
        type="number"
        defaultValue={String(dailyCap)}
      />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="check"
        pendingLabel="Saving limit"
      >
        Save limit
      </PendingSubmitButton>
    </form>
  );
}

function MessageToneForm({
  profile,
}: {
  profile: ProductCompanyProfile | null;
}) {
  return (
    <form action={editCompanyProfileAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/profile#agent" />
      <CompanyProfileHiddenFields profile={profile} omit={["message_tone"]} />
      <Select
        name="message_tone"
        label="Message tone"
        defaultValue={profile?.message_tone ?? "professional"}
        options={messageToneOptions()}
      />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="save"
        pendingLabel="Saving tone"
      >
        Save tone
      </PendingSubmitButton>
    </form>
  );
}

function VoiceActivationForm({
  rep,
  icp,
  outlookAccount,
}: {
  rep: ProfileRepRow | null;
  icp: ProfileIcpRow | null;
  outlookAccount: ProfileOutlookAccount | null;
}) {
  const approval = profileApproval(rep);
  return (
    <form action={configureActivationAction} className="section-note grid gap-5">
      <input type="hidden" name="return_to" value="/dashboard/profile#agent" />
      <ActivationHiddenFields
        rep={rep}
        icp={icp}
        outlookAccount={outlookAccount}
        omit={["rep_voice", "rep_story", "approval"]}
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
      <Select
        name="approval"
        label="Review mode"
        defaultValue={approval}
        options={approvalOptions()}
      />
      <PendingSubmitButton
        className="btn-solid w-fit"
        icon="check"
        pendingLabel="Saving voice"
      >
        Save voice and review
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
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              LinkedIn accounts
            </p>
            <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-3)]">
              Coming soon
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
            LinkedIn connection requests and DMs are coming soon. Outlook is
            live now — connect it to start outreach today.
          </p>
        </div>
      </div>

      {accounts.length > 0 ? (
        <div className="grid gap-3">
          {slots.map((account, index) => (
            <LinkedInAccountSlot
              key={account?.id ?? `linkedin-slot-${index}`}
              account={account}
              label={index === 0 ? "First account" : "Second account"}
            />
          ))}
        </div>
      ) : null}
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
    <Link href={`/dashboard/agent/outreach/${row.conversation_id}`} prefetch={false}>
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

function expiresWhen(value: Date): string {
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function mcpScopeList(scope: string | null): string[] {
  const scopes = (scope ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return scopes.length ? scopes : ["brief:read", "profile:read"];
}

function profileWorkspaceName(
  workspaceName: string,
  profile: ProductCompanyProfile | null,
): string {
  const trimmed = workspaceName.trim();
  if (trimmed && trimmed.toLowerCase() !== "default workspace") return trimmed;
  return profile?.company_name?.trim() || trimmed || "Workspace";
}

function linkedinSignalBehaviorDefault(
  profile: ProductCompanyProfile | null,
): string {
  return (
    profile?.linkedin_signal_behaviors ??
    "Company and team engagement\nKeyworded post likes and comments\nRelevant LinkedIn profiles\nCompetitor engagement"
  );
}

function profileIcpDescription(icp: ProfileIcpRow | null): string {
  return (
    icp?.description ??
    "Companies showing fresh hiring intent around GTM, operations, or revenue roles."
  );
}

function profileRepVoice(rep: ProfileRepRow | null): string {
  return (
    rep?.persona.voice ??
    "Direct, warm, specific, and allergic to generic sales fluff."
  );
}

function profileRepStory(rep: ProfileRepRow | null): string {
  return (
    rep?.persona.story ??
    "Open with the qualified signal, name the verified contact or LinkedIn profile, tie it to one relevant business reason, and ask for one concrete next step."
  );
}

function profileDailyCap(
  rep: ProfileRepRow | null,
  outlookAccount: ProfileOutlookAccount | null,
): number {
  return rep?.autonomy?.channels?.email?.daily_cap ?? outlookAccount?.daily_cap ?? 25;
}

function profileApproval(rep: ProfileRepRow | null): string {
  return rep?.autonomy?.channels?.email?.approval ?? "none";
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
