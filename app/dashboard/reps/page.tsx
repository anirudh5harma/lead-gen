import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  HeroStat,
  SurfaceHero,
  SurfaceSection,
} from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import {
  loadWorkspaceLaunchReadiness,
  type WorkspaceLaunchReadiness,
} from "@/core/product/launch-readiness.ts";
import {
  loadQualifiedSignalWorkbench,
  type QualifiedSignalContact,
  type QualifiedSignalItem,
  type QualifiedSignalWorkbench,
} from "@/core/product/qualified-signals.ts";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import {
  checkAgentSourcesAction,
  dismissQualifiedSignalAction,
  runAgentSourceNowAction,
} from "../actions";

export const dynamic = "force-dynamic";

interface RepRow {
  id: string;
  name: string;
  role: string;
  status: string;
  persona: {
    voice?: string;
    story?: string;
  };
  autonomy: {
    channels?: Record<string, RepChannelPolicy>;
  } | null;
  open_conversations: string;
  sent_7d: string;
  outcomes_7d: string;
}

interface RepChannelPolicy {
  daily_cap?: number;
  approval?: string;
}

interface ChannelRow {
  id: string;
  display_name: string;
  kind: string;
  status: string;
  daily_cap: number | null;
  last_error: string | null;
}

interface ChannelConnection {
  connected: boolean;
  label: string;
  status: string;
  dailyCap: number | null;
  href: string;
}

interface ChannelCoverage {
  email: ChannelConnection;
  linkedIn: ChannelConnection;
}

interface AgentActivity {
  active_workflows: number;
  events_last_hour: number;
  outbound_last_hour: number;
  reviews_pending: number;
  event_types: Array<{ event_type: string; count: number }>;
}

interface AgentOutreachRow {
  id: string;
  conversation_id: string;
  channel: string;
  status: string;
  subject: string | null;
  body: string | null;
  sent_at: Date | null;
  created_at: Date;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
}

interface AgentOutreachSummary {
  recent: AgentOutreachRow[];
  email_sent_7d: number;
  linkedin_sent_7d: number;
  awaiting_reply: number;
}

interface AgentContactRow {
  id: string;
  full_name: string;
  title: string | null;
  emails: string[];
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  fresh_signals: string;
  conversations: string;
  updated_at: Date;
}

interface AgentContactSummary {
  recent: AgentContactRow[];
  reachable: number;
  with_email: number;
  with_linkedin: number;
  fresh_signals: number;
}

interface AgentSourceRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  poll_cadence_sec: number;
  last_polled_at: Date | null;
  source_last_polled_at: Date | null;
  last_error: Record<string, unknown> | null;
  signal_kind: string | null;
  query: string | null;
  source_reason: string | null;
  source_tier: string | null;
  signals_total: string;
  signals_week: string;
  matched_week: string;
}

interface AgentSequenceStep {
  id: string;
  name: string;
  channel: string;
  declaration: string;
  status: string;
  daily_cap: number | null;
  approval: string | null;
  steps: string[];
}

interface AgentSourceStrategy {
  icp: {
    id: string;
    name: string;
    description: string;
    match_threshold: number;
    nice_to_haves: string[];
    must_haves: string[];
  } | null;
  profile: {
    signal_keywords: string[];
    competitor_watchlist: string[];
    target_titles: string[];
    target_markets: string[];
    exclusion_rules: string[];
  };
  sources: AgentSourceRow[];
  sequence: AgentSequenceStep[];
}

interface RepsState {
  reps: RepRow[];
  channels: ChannelRow[];
  readiness: WorkspaceLaunchReadiness;
  activity: AgentActivity;
  strategy: AgentSourceStrategy;
  opportunities: QualifiedSignalWorkbench;
  outreach: AgentOutreachSummary;
  contacts: AgentContactSummary;
}

async function loadRepsState(workspaceId: string): Promise<RepsState> {
  const pool = getPool();
  const [
    reps,
    channels,
    readiness,
    activity,
    strategy,
    opportunities,
    outreach,
    contacts,
  ] = await Promise.all([
    pool.query<RepRow>(
      `select r.id,
              r.name,
              r.role::text as role,
              r.status::text as status,
              r.persona,
              r.autonomy,
              (select count(*)::text
                 from conversations c
                where c.workspace_id = $1
                  and c.rep_id = r.id
                  and c.status in ('open','awaiting_them','awaiting_us')) as open_conversations,
              (select count(*)::text
                 from messages m
                 join conversations c on c.id = m.conversation_id
                where m.workspace_id = $1
                  and c.rep_id = r.id
                  and m.direction = 'outbound'
                  and m.created_at >= now() - interval '7 days') as sent_7d,
              (select count(*)::text
                 from outcomes o
                where o.workspace_id = $1
                  and o.attributed_rep_id = r.id
                  and o.kind in ('positive_reply','meeting_booked','opportunity_created','deal_won')
                  and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as outcomes_7d
         from reps r
        where r.workspace_id = $1
          and r.status <> 'retired'
        order by r.created_at asc`,
      [workspaceId],
    ),
    pool.query<ChannelRow>(
      `with ranked_accounts as (
         select id,
                display_name,
                kind::text as kind,
                status::text as status,
                daily_cap,
                last_error,
                updated_at,
                created_at,
                row_number() over (
                  partition by case
                    when kind = 'oauth_outlook' then 'outlook:' || coalesce(
                      nullif(lower(properties ->> 'mailbox_email'), ''),
                      nullif(lower(display_name), ''),
                      id::text
                    )
                    when kind in ('linkedin_session','linkedin_oauth') then 'linkedin:' || coalesce(
                      nullif(lower(display_name), ''),
                      id::text
                    )
                    else id::text
                  end
                  order by case when status = 'connected' then 0 else 1 end,
                           updated_at desc,
                           created_at desc
                ) as account_rank
           from channel_accounts
          where workspace_id = $1
            and kind in ('oauth_outlook','linkedin_session','linkedin_oauth')
       )
       select id, display_name, kind, status, daily_cap, last_error
         from ranked_accounts
        where account_rank = 1
        order by case
                   when kind = 'oauth_outlook' then 0
                   else 1
                 end,
                 display_name asc`,
      [workspaceId],
    ),
    loadWorkspaceLaunchReadiness(pool, workspaceId, { required_channel: "any" }),
    loadAgentActivity(workspaceId),
    loadAgentSourceStrategy(workspaceId),
    loadQualifiedSignalWorkbench(pool, workspaceId, { limit: 5 }),
    loadAgentOutreachSummary(workspaceId),
    loadAgentContactSummary(workspaceId),
  ]);
  return {
    reps: reps.rows,
    channels: channels.rows,
    readiness,
    activity,
    strategy,
    opportunities,
    outreach,
    contacts,
  };
}

async function loadAgentSourceStrategy(
  workspaceId: string,
): Promise<AgentSourceStrategy> {
  const pool = getPool();
  const [icp, profile, sources, sequence] = await Promise.all([
    pool.query<{
      id: string;
      name: string;
      description: string;
      match_threshold: string;
      nice_to_haves: unknown;
      must_haves: unknown;
    }>(
      `select id,
              name,
              description,
              match_threshold::text as match_threshold,
              nice_to_haves,
              must_haves
         from workspace_icps
        where workspace_id = $1
          and enabled
        order by created_at asc
        limit 1`,
      [workspaceId],
    ),
    pool.query<{
      signal_keywords: string | null;
      competitor_watchlist: string | null;
      target_titles: string | null;
      target_markets: string | null;
      exclusion_rules: string | null;
    }>(
      `select properties->>'signal_keywords' as signal_keywords,
              properties->>'competitor_watchlist' as competitor_watchlist,
              properties->>'target_titles' as target_titles,
              properties->>'target_markets' as target_markets,
              properties->>'exclusion_rules' as exclusion_rules
         from graph_companies
        where workspace_id = $1
          and properties->>'profile_role' = 'workspace_company'
        order by updated_at desc
        limit 1`,
      [workspaceId],
    ),
    pool.query<AgentSourceRow>(
      `select gs.id::text as id,
              gs.name,
              gs.kind::text as kind,
              (wsc.enabled and gs.enabled) as enabled,
              wsc.poll_cadence_sec,
              wsc.last_polled_at,
              gs.last_polled_at as source_last_polled_at,
              wsc.last_error,
              coalesce(wsc.config_overrides->>'signal_kind', gs.config->>'signal_kind') as signal_kind,
              coalesce(wsc.config_overrides->>'query', gs.config->>'query', gs.config->>'url') as query,
              coalesce(wsc.config_overrides->>'source_reason', gs.config->>'source_reason') as source_reason,
              coalesce(wsc.config_overrides->>'source_tier', gs.config->>'source_tier') as source_tier,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id) as signals_total,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id
                  and s.ingested_at >= now() - interval '7 days') as signals_week,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id
                  and s.status in ('matched','in_play')
                  and s.ingested_at >= now() - interval '7 days') as matched_week
         from workspace_source_configs wsc
         join graph_sources gs
           on gs.workspace_id = wsc.workspace_id
          and gs.id = wsc.source_id
        where wsc.workspace_id = $1
        order by (wsc.enabled and gs.enabled) desc,
                 coalesce(wsc.last_polled_at, gs.last_polled_at, '-infinity'::timestamptz) desc,
                 gs.created_at asc
        limit 6`,
      [workspaceId],
    ),
    pool.query<{
      id: string;
      name: string;
      declaration: string;
      compiled: Record<string, unknown>;
      autonomy: Record<string, unknown>;
      status: string;
      created_at: Date;
    }>(
      `select id,
              name,
              declaration,
              compiled,
              autonomy,
              status::text as status,
              created_at
         from plays
        where workspace_id = $1
          and status in ('active','draft','paused')
          and coalesce(compiled->>'channel', '') in (
            'email',
            'linkedin_dm',
            'linkedin_inmail',
            'linkedin_connection',
            'linkedin_comment'
          )
        order by case status when 'active' then 0 when 'draft' then 1 else 2 end,
                 created_at asc
        limit 8`,
      [workspaceId],
    ),
  ]);
  const icpRow = icp.rows[0];
  const profileRow = profile.rows[0];
  return {
    icp: icpRow
      ? {
          id: icpRow.id,
          name: icpRow.name,
          description: icpRow.description,
          match_threshold: Number(icpRow.match_threshold),
          nice_to_haves: stringArray(icpRow.nice_to_haves),
          must_haves: stringArray(icpRow.must_haves),
        }
      : null,
    profile: {
      signal_keywords: setupLines(profileRow?.signal_keywords),
      competitor_watchlist: setupLines(profileRow?.competitor_watchlist),
      target_titles: setupLines(profileRow?.target_titles),
      target_markets: setupLines(profileRow?.target_markets),
      exclusion_rules: setupLines(profileRow?.exclusion_rules),
    },
    sources: sources.rows,
    sequence: sequence.rows.map((row) => sequenceStepFromPlay(row)),
  };
}

async function loadAgentActivity(workspaceId: string): Promise<AgentActivity> {
  const pool = getPool();
  const [summary, eventTypes] = await Promise.all([
    pool.query<{
      active_workflows: string;
      events_last_hour: string;
      outbound_last_hour: string;
      reviews_pending: string;
    }>(
      `select
         (select count(*)::text from workflow_runs wr
            where wr.workspace_id = $1
              and wr.status in ('pending','running','awaiting_approval','awaiting_event')) as active_workflows,
         (select count(*)::text from events e
            where e.workspace_id = $1
              and e.occurred_at >= now() - interval '1 hour') as events_last_hour,
         (select count(*)::text from messages m
            where m.workspace_id = $1
              and m.direction = 'outbound'
              and m.created_at >= now() - interval '1 hour') as outbound_last_hour,
         (select count(*)::text from workflow_approvals a
            where a.workspace_id = $1
              and a.decision = 'pending') as reviews_pending`,
      [workspaceId],
    ),
    pool.query<{ event_type: string; count: string }>(
      `select e.event_type, count(*)::text as count
         from events e
        where e.workspace_id = $1
          and e.occurred_at >= now() - interval '1 hour'
        group by e.event_type
        order by count(*) desc, e.event_type asc
        limit 5`,
      [workspaceId],
    ),
  ]);
  return {
    active_workflows: Number(summary.rows[0]?.active_workflows ?? 0),
    events_last_hour: Number(summary.rows[0]?.events_last_hour ?? 0),
    outbound_last_hour: Number(summary.rows[0]?.outbound_last_hour ?? 0),
    reviews_pending: Number(summary.rows[0]?.reviews_pending ?? 0),
    event_types: eventTypes.rows.map((row) => ({
      event_type: row.event_type,
      count: Number(row.count),
    })),
  };
}

async function loadAgentContactSummary(
  workspaceId: string,
): Promise<AgentContactSummary> {
  const pool = getPool();
  const [recent, summary] = await Promise.all([
    pool.query<AgentContactRow>(
      `select p.id,
              p.full_name,
              p.title,
              coalesce(p.emails, '{}'::text[]) as emails,
              p.linkedin_url,
              co.name as company_name,
              co.domain::text as company_domain,
              p.updated_at,
              (select count(*)::text
                 from signals s
                where s.workspace_id = $1
                  and s.status in ('ingested','matched','in_play')
                  and (
                    s.related_person_id = p.id
                    or (p.company_id is not null and s.related_company_id = p.company_id)
                  )
                  and s.ingested_at >= now() - interval '14 days') as fresh_signals,
              (select count(*)::text
                 from conversations c
                where c.workspace_id = $1
                  and c.counterparty_person_id = p.id) as conversations
         from graph_persons p
         left join graph_companies co on co.id = p.company_id
        where p.workspace_id = $1
          and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)
        order by coalesce(
                   (select max(s.ingested_at)
                      from signals s
                     where s.workspace_id = $1
                       and (
                         s.related_person_id = p.id
                         or (p.company_id is not null and s.related_company_id = p.company_id)
                       )),
                   (select max(c.last_activity_at)
                      from conversations c
                     where c.workspace_id = $1
                       and c.counterparty_person_id = p.id),
                   p.updated_at
                 ) desc
        limit 5`,
      [workspaceId],
    ),
    pool.query<{
      reachable: string;
      with_email: string;
      with_linkedin: string;
      fresh_signals: string;
    }>(
      `select
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)) as reachable,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and cardinality(coalesce(p.emails, '{}'::text[])) > 0) as with_email,
         (select count(*)::text
            from graph_persons p
           where p.workspace_id = $1
             and p.linkedin_url is not null) as with_linkedin,
         (select count(*)::text
            from signals s
           where s.workspace_id = $1
             and s.status in ('ingested','matched','in_play')
             and s.ingested_at >= now() - interval '14 days') as fresh_signals`,
      [workspaceId],
    ),
  ]);
  return {
    recent: recent.rows,
    reachable: Number(summary.rows[0]?.reachable ?? 0),
    with_email: Number(summary.rows[0]?.with_email ?? 0),
    with_linkedin: Number(summary.rows[0]?.with_linkedin ?? 0),
    fresh_signals: Number(summary.rows[0]?.fresh_signals ?? 0),
  };
}

async function loadAgentOutreachSummary(
  workspaceId: string,
): Promise<AgentOutreachSummary> {
  const pool = getPool();
  const [recent, summary] = await Promise.all([
    pool.query<AgentOutreachRow>(
      `select m.id,
              m.conversation_id,
              m.channel::text as channel,
              m.status::text as status,
              m.subject,
              m.body,
              m.sent_at,
              m.created_at,
              p.full_name as counterparty_name,
              co.name as company_name,
              s.title as signal_title
         from messages m
         join conversations c on c.id = m.conversation_id
         left join graph_persons p on p.id = c.counterparty_person_id
         left join graph_companies co on co.id = c.counterparty_company_id
         left join signals s on s.id = c.origin_signal_id
        where m.workspace_id = $1
          and m.direction = 'outbound'
          and m.channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
          and m.status in ('sent','delivered','replied')
        order by coalesce(m.sent_at, m.created_at) desc
        limit 30`,
      [workspaceId],
    ),
    pool.query<{
      email_sent_7d: string;
      linkedin_sent_7d: string;
      awaiting_reply: string;
    }>(
      `select
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel = 'email'
              and status in ('sent','delivered','replied')
              and coalesce(sent_at, created_at) >= now() - interval '7 days') as email_sent_7d,
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel in ('linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
              and status in ('sent','delivered','replied')
              and coalesce(sent_at, created_at) >= now() - interval '7 days') as linkedin_sent_7d,
         (select count(*)::text from messages
            where workspace_id = $1
              and direction = 'outbound'
              and channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
              and status in ('sent','delivered')
              and coalesce(sent_at, created_at) >= now() - interval '14 days') as awaiting_reply`,
      [workspaceId],
    ),
  ]);
  return {
    recent: recent.rows,
    email_sent_7d: Number(summary.rows[0]?.email_sent_7d ?? 0),
    linkedin_sent_7d: Number(summary.rows[0]?.linkedin_sent_7d ?? 0),
    awaiting_reply: Number(summary.rows[0]?.awaiting_reply ?? 0),
  };
}

export default async function RepsPage() {
  const active = await getActiveWorkspaceSession();
  if (!active) return <NoWorkspaceReps />;

  const state = await loadSafeRepsState(active.workspace.id);
  const visibleReps = state.reps.filter(isVisibleProductAgent);
  const activeAgents = visibleReps.filter((rep) => rep.status === "active").length;
  const connectedChannels = state.channels.filter(
    (channel) => channel.status === "connected",
  ).length;
  const coverage = workspaceChannelCoverage(state.channels);
  const sequence =
    state.strategy.sequence.length > 0
      ? state.strategy.sequence
      : fallbackSequenceFromReps(visibleReps);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Agent"
        title={
          <>
            Watch email and LinkedIn <em>outreach</em>.
          </>
        }
        description="Live work, sent emails and DMs, verified contacts, and reply learning in one focused workspace."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Active agents" value={activeAgents} />
            <HeroStat label="Channels" value={connectedChannels} />
            <HeroStat
              label="Launch"
              value={state.readiness.launch_ready ? "Ready" : "Blocked"}
            />
          </div>
        }
      />

      <AgentActivityPanel activity={state.activity} />

      <AgentStrategyPanel strategy={state.strategy} />

      <AgentSequencePanel sequence={sequence} />

      <AgentOpportunityPanel opportunities={state.opportunities} />

      <AgentOutreachPanel outreach={state.outreach} />

      <AgentContactsPanel contacts={state.contacts} />

      <SurfaceSection
        title="Agent"
        action={
          <Link href="/dashboard/settings#motion" className="btn-solid-sm">
            <Icon name="edit_note" size={14} />
            Tune agent
          </Link>
        }
      >
        {visibleReps.length === 0 ? (
          <EmptyState
            title="No agent configured yet."
            hint="Start by defining the workspace profile, audience, voice, and approval mode."
            cta={{
              href: "/dashboard/settings#motion",
              label: "Configure agent",
              icon: "badge",
            }}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleReps.map((rep) => (
              <RepCard key={rep.id} rep={rep} coverage={coverage} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

async function loadSafeRepsState(workspaceId: string): Promise<RepsState> {
  try {
    return await loadRepsState(workspaceId);
  } catch (err) {
    console.error("[dashboard/agent] failed to load agent state", err);
    return emptyRepsState(workspaceId);
  }
}

function emptyRepsState(workspaceId: string): RepsState {
  return {
    reps: [],
    channels: [],
    readiness: {
      workspace_id: workspaceId,
      checked_at: new Date().toISOString(),
      required_channel: "any",
      status: "blocked",
      launch_ready: false,
      next_action: "configure_profile",
      checks: [],
      blockers: ["Agent state is temporarily unavailable."],
      warnings: [],
    },
    activity: {
      active_workflows: 0,
      events_last_hour: 0,
      outbound_last_hour: 0,
      reviews_pending: 0,
      event_types: [],
    },
    strategy: {
      icp: null,
      profile: {
        signal_keywords: [],
        competitor_watchlist: [],
        target_titles: [],
        target_markets: [],
        exclusion_rules: [],
      },
      sources: [],
      sequence: [],
    },
    outreach: {
      recent: [],
      email_sent_7d: 0,
      linkedin_sent_7d: 0,
      awaiting_reply: 0,
    },
    opportunities: {
      signals: [],
      stats: {
        qualified: 0,
        with_verified_contacts: 0,
        with_email_draft: 0,
        ready_for_review: 0,
      },
    },
    contacts: {
      recent: [],
      reachable: 0,
      with_email: 0,
      with_linkedin: 0,
      fresh_signals: 0,
    },
  };
}

function AgentStrategyPanel({ strategy }: { strategy: AgentSourceStrategy }) {
  const activeSources = strategy.sources.filter((source) => source.enabled).length;
  const signalKinds = uniqueStrings(
    strategy.sources
      .map((source) => source.signal_kind)
      .filter((value): value is string => Boolean(value)),
  );
  const keywords = strategy.profile.signal_keywords.slice(0, 5);
  const competitors = strategy.profile.competitor_watchlist.slice(0, 5);
  return (
    <div id="sources" className="scroll-mt-28">
      <SurfaceSection
        title="Source strategy"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <form action={checkAgentSourcesAction}>
              <input type="hidden" name="return_to" value="/dashboard/agent" />
              <input type="hidden" name="limit" value="25" />
              <button type="submit" className="btn-solid-sm">
                <Icon name="sync_alt" size={14} />
                Check sources
              </button>
            </form>
            <Link href="/dashboard/settings#profile" className="btn-quiet-sm">
              <Icon name="edit_note" size={14} />
              Tune profile
            </Link>
          </div>
        }
      >
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {strategy.icp?.name ?? "Audience not configured"}
            </p>
            <p className="mt-1 line-clamp-4 text-xs leading-5 text-[var(--color-text-3)]">
              {strategy.icp?.description ??
                "Define buyer roles, markets, exclusions, signal keywords, and competitors in Profile."}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <MiniStat label="Active sources" value={activeSources} />
            <MiniStat label="Signal types" value={signalKinds.length} />
            <MiniStat
              label="Match gate"
              value={Math.round((strategy.icp?.match_threshold ?? 0) * 100)}
            />
          </div>
          <div className="grid gap-2">
            <StrategyChips
              icon="person_search"
              label="Buyer roles"
              values={strategy.profile.target_titles}
              empty="Add roles"
            />
            <StrategyChips
              icon="public"
              label="Markets"
              values={strategy.profile.target_markets}
              empty="Add markets"
            />
            <StrategyChips
              icon="block"
              label="Exclusions"
              values={strategy.profile.exclusion_rules}
              empty="No exclusions"
            />
          </div>
        </aside>

        <div className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <StrategyKeywordBox
              icon="travel_explore"
              title="Keywords watched"
              values={keywords}
              empty="Add signal keywords in Profile."
            />
            <StrategyKeywordBox
              icon="radar"
              title="Competitor audience"
              values={competitors}
              empty="Add competitors whose audience matters."
            />
          </div>

          {strategy.sources.length === 0 ? (
            <EmptyState
              title="No signal sources yet"
              hint="Profile setup creates source configs for launch, hiring, funding, and market movement signals."
              cta={{
                href: "/dashboard/settings#profile",
                label: "Tune profile",
                icon: "edit_note",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {strategy.sources.map((source) => (
                <SourceStrategyRow key={source.id} source={source} />
              ))}
            </div>
          )}
        </div>
      </div>
      </SurfaceSection>
    </div>
  );
}

function StrategyChips({
  icon,
  label,
  values,
  empty,
}: {
  icon: string;
  label: string;
  values: string[];
  empty: string;
}) {
  const visible = values.slice(0, 3);
  return (
    <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-3)]">
        <Icon name={icon} size={13} />
        {label}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {visible.length === 0 ? (
          <span className="text-xs text-[var(--color-text-4)]">{empty}</span>
        ) : (
          <>
            {visible.map((value) => (
              <span
                key={value}
                className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-2)]"
              >
                {value}
              </span>
            ))}
            {values.length > visible.length ? (
              <span className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
                +{values.length - visible.length}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function StrategyKeywordBox({
  icon,
  title,
  values,
  empty,
}: {
  icon: string;
  title: string;
  values: string[];
  empty: string;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-1)]">
        <Icon name={icon} size={15} />
        {title}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {values.length === 0 ? (
          <span className="text-sm text-[var(--color-text-3)]">{empty}</span>
        ) : (
          values.map((value) => (
            <span
              key={value}
              className="rounded-[8px] bg-[var(--color-accent-bg)] px-2.5 py-1 text-xs text-[var(--color-accent)]"
            >
              {value}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function SourceStrategyRow({ source }: { source: AgentSourceRow }) {
  const total = Number(source.signals_total);
  const week = Number(source.signals_week);
  const matched = Number(source.matched_week);
  const lastPolled = source.last_polled_at ?? source.source_last_polled_at;
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={
            "grid size-9 shrink-0 place-items-center rounded-[8px] " +
            (source.enabled
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
          }
        >
          <Icon name="sensors" size={17} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {source.name}
          </p>
          <p className="mt-1 truncate text-sm text-[var(--color-text-2)]">
            {source.query ?? source.source_reason ?? source.kind.replace(/_/g, " ")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <OpportunityPill tone={source.enabled ? "ready" : "waiting"}>
              {source.enabled ? "Active" : "Paused"}
            </OpportunityPill>
            {source.signal_kind ? (
              <OpportunityPill tone="fit">
                {source.signal_kind.replace(/_/g, " ")}
              </OpportunityPill>
            ) : null}
            {source.source_tier ? (
              <OpportunityPill tone="waiting">
                {source.source_tier.replace(/_/g, " ")}
              </OpportunityPill>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {week} new / {matched} qualified
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {total} total
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {nextRunLabel(lastPolled, source.poll_cadence_sec)}
        </span>
        {source.enabled ? (
          <form action={runAgentSourceNowAction}>
            <input type="hidden" name="source_id" value={source.id} />
            <input type="hidden" name="return_to" value="/dashboard/agent" />
            <button type="submit" className="btn-quiet-sm" title="Run source now">
              <Icon name="play_arrow" size={14} />
              Run now
            </button>
          </form>
        ) : (
          <span className="inline-flex h-8 items-center rounded-[8px] bg-[var(--color-ink-2)] px-2.5 text-xs text-[var(--color-text-3)]">
            Paused
          </span>
        )}
      </div>
    </article>
  );
}

function AgentSequencePanel({ sequence }: { sequence: AgentSequenceStep[] }) {
  return (
    <SurfaceSection
      title="Sequence"
      action={
        <Link href="/dashboard/settings#motion" className="btn-quiet-sm">
          <Icon name="rule" size={14} />
          Review limits
        </Link>
      }
    >
      {sequence.length === 0 ? (
        <EmptyState
          title="No outreach sequence yet"
          hint="The agent needs active email or LinkedIn plays before it can move qualified signals into outreach."
          cta={{
            href: "/dashboard/settings#motion",
            label: "Configure agent",
            icon: "rule",
          }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {sequence.map((step, index) => (
            <SequenceStepCard key={step.id} step={step} index={index} />
          ))}
        </div>
      )}
    </SurfaceSection>
  );
}

function SequenceStepCard({
  step,
  index,
}: {
  step: AgentSequenceStep;
  index: number;
}) {
  const channel = channelLabel(step.channel);
  return (
    <article className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={step.channel === "email" ? "mail" : "forum"} size={17} />
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
          Step {index + 1}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-[var(--color-text-1)]">
        {channel}
      </p>
      <p className="mt-1 line-clamp-2 text-sm text-[var(--color-text-2)]">
        {step.name}
      </p>
      <p className="mt-3 line-clamp-3 text-xs leading-5 text-[var(--color-text-3)]">
        {step.declaration}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <OpportunityPill tone={step.status === "active" ? "ready" : "waiting"}>
          {statusLabel(step.status)}
        </OpportunityPill>
        <OpportunityPill tone="waiting">
          {step.daily_cap == null ? "No cap" : `${step.daily_cap}/day`}
        </OpportunityPill>
        {step.approval ? (
          <OpportunityPill tone="waiting">
            {approvalLabel(step.approval)}
          </OpportunityPill>
        ) : null}
      </div>
      {step.steps.length > 0 ? (
        <p className="mt-3 text-[11px] leading-5 text-[var(--color-text-4)]">
          {step.steps.map((item) => item.replace(/\./g, " ")).join(" -> ")}
        </p>
      ) : null}
    </article>
  );
}

function AgentOpportunityPanel({
  opportunities,
}: {
  opportunities: QualifiedSignalWorkbench;
}) {
  return (
    <SurfaceSection
      title="Opportunities"
      action={
        <Link href="/dashboard/signals" className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Open signals
        </Link>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="grid gap-2 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Signal-to-outreach queue
          </p>
          <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-1">
            <MiniStat label="Qualified" value={opportunities.stats.qualified} />
            <MiniStat
              label="Verified contacts"
              value={opportunities.stats.with_verified_contacts}
            />
            <MiniStat
              label="Drafted"
              value={opportunities.stats.with_email_draft}
            />
            <MiniStat
              label="Needs review"
              value={opportunities.stats.ready_for_review}
            />
          </div>
          <p className="text-xs leading-5 text-[var(--color-text-3)]">
            The agent ranks qualified signals by fit, checks reachable people,
            and prepares judged outreach before anything leaves a channel.
          </p>
        </aside>

        {opportunities.signals.length === 0 ? (
          <EmptyState
            title="No opportunities ready yet"
            hint="Complete the profile, define targeting, and connect accounts so qualified signals can turn into verified outreach."
            cta={{
              href: "/dashboard/settings#profile",
              label: "Tune profile",
              icon: "person_search",
            }}
          />
        ) : (
          <div className="grid gap-2">
            {opportunities.signals.map((signal) => (
              <AgentOpportunityLink key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </div>
    </SurfaceSection>
  );
}

function AgentOpportunityLink({ signal }: { signal: QualifiedSignalItem }) {
  const contact = signal.contacts[0];
  const company = signal.company.name ?? signal.company.domain ?? "Unknown company";
  const score = signal.match_score == null ? null : Math.round(signal.match_score * 100);
  const href = opportunityHref(signal, contact);
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <Link
        href={href}
        prefetch={false}
        className="flex min-w-0 items-start gap-3 rounded-[8px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
          <Icon name="sensors" size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {company}
            <span className="font-normal text-[var(--color-text-3)]">
              {" "}
              / {signal.kind.replace(/_/g, " ")}
            </span>
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {signal.title}
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            {score == null ? null : (
              <OpportunityPill tone="fit">{score}% fit</OpportunityPill>
            )}
            <OpportunityPill tone={contact ? "ready" : "waiting"}>
              {contact ? contactLabel(contact) : "Resolving contact"}
            </OpportunityPill>
            <OpportunityPill tone={signal.email_draft ? "ready" : "waiting"}>
              {signal.email_draft
                ? draftOpportunityLabel(signal.email_draft.status)
                : "Draft pending"}
            </OpportunityPill>
          </span>
          {signal.match_reason ? (
            <span className="mt-2 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
              {signal.match_reason}
            </span>
          ) : null}
        </span>
      </Link>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {statusLabel(signal.status)}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(signal.freshness_at)}
        </span>
        <form action={dismissQualifiedSignalAction}>
          <input type="hidden" name="signal_id" value={signal.id} />
          <input type="hidden" name="return_to" value="/dashboard/agent" />
          <input
            type="hidden"
            name="reason"
            value="Skipped from Agent because the opportunity is not a fit for outreach."
          />
          <button type="submit" className="btn-quiet-sm" title="Skip opportunity">
            <Icon name="block" size={14} />
            Skip
          </button>
        </form>
      </span>
    </article>
  );
}

function OpportunityPill({
  tone,
  children,
}: {
  tone: "fit" | "ready" | "waiting";
  children: ReactNode;
}) {
  const toneClass =
    tone === "fit"
      ? "bg-[var(--color-accent-bg)] text-[var(--color-accent)]"
      : tone === "ready"
        ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
        : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]";
  return (
    <span className={"rounded-[8px] px-2.5 py-1 text-xs " + toneClass}>
      {children}
    </span>
  );
}

function contactLabel(contact: QualifiedSignalContact): string {
  if (contact.verification.email_verified) return "Verified email";
  if (contact.linkedin_url) return "LinkedIn profile";
  if (contact.emails.length > 0) return "Email found";
  return "Contact found";
}

function draftOpportunityLabel(status: string): string {
  if (status === "draft") return "Draft ready";
  if (status === "deferred") return "Draft deferred";
  if (status === "sent" || status === "delivered") return "Sent";
  return statusLabel(status);
}

function opportunityHref(
  signal: QualifiedSignalItem,
  contact?: QualifiedSignalContact,
): string {
  if (signal.email_draft) {
    return sentDraftHref(
      signal.email_draft.conversation_id,
      signal.email_draft.message_id,
    );
  }
  if (contact?.person_id) return `/dashboard/prospects/${contact.person_id}`;
  return "/dashboard/signals";
}

function AgentContactsPanel({
  contacts,
}: {
  contacts: AgentContactSummary;
}) {
  return (
    <div id="verified-contacts">
      <SurfaceSection
        title="Verified contacts"
        action={
          <Link href="/dashboard/settings#contact-quality" className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            Contact quality
          </Link>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="grid gap-2 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Signal-ready contacts
            </p>
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-1">
              <MiniStat label="Reachable" value={contacts.reachable} />
              <MiniStat label="Email handles" value={contacts.with_email} />
              <MiniStat label="LinkedIn profiles" value={contacts.with_linkedin} />
              <MiniStat label="Signals 14d" value={contacts.fresh_signals} />
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-3)]">
              The agent uses these verified emails and LinkedIn profiles when a
              qualified signal is ready to become outreach.
            </p>
          </aside>

          {contacts.recent.length === 0 ? (
            <EmptyState
              title="No verified contacts yet"
              hint="Tune the profile and connect accounts so the agent can resolve emails and LinkedIn profiles from qualified signals."
              cta={{
                href: "/dashboard/settings#profile",
                label: "Update profile",
                icon: "person",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {contacts.recent.map((contact) => (
                <AgentContactLink key={contact.id} contact={contact} />
              ))}
            </div>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function AgentContactLink({ contact }: { contact: AgentContactRow }) {
  const company = contact.company_name ?? contact.company_domain ?? "Unknown company";
  const signals = Number(contact.fresh_signals);
  const conversations = Number(contact.conversations);
  return (
    <Link
      href={`/dashboard/prospects/${contact.id}`}
      prefetch={false}
      className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name="person" size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {contact.full_name}
            <span className="font-normal text-[var(--color-text-3)]">
              {" "}
              at {company}
            </span>
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {contact.title ?? "Role unknown"}
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <ContactPill ready={contact.emails.length > 0} icon="mail">
              {contact.emails[0] ?? "No email"}
            </ContactPill>
            <ContactPill ready={Boolean(contact.linkedin_url)} icon="forum">
              {contact.linkedin_url ? "LinkedIn profile" : "No LinkedIn"}
            </ContactPill>
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        {signals > 0 ? (
          <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-2.5 py-1 text-xs text-[var(--color-accent)]">
            {signals} signal{signals === 1 ? "" : "s"}
          </span>
        ) : null}
        {conversations > 0 ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
            {conversations} conversation{conversations === 1 ? "" : "s"}
          </span>
        ) : null}
      </span>
    </Link>
  );
}

function ContactPill({
  ready,
  icon,
  children,
}: {
  ready: boolean;
  icon: string;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex max-w-full items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
        (ready
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-3)]")
      }
    >
      <Icon name={icon} size={13} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function AgentActivityPanel({ activity }: { activity: AgentActivity }) {
  const active =
    activity.active_workflows > 0 ||
    activity.events_last_hour > 0 ||
    activity.outbound_last_hour > 0;
  const currentWork = agentCurrentWork(activity);
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {active ? "Working now" : "Idle right now"}
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-3)]">
              {currentWork}
            </p>
          </div>
          <span className="rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1 text-xs font-medium text-[var(--color-accent)]">
            {activity.active_workflows} active
          </span>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <MiniStat label="Events last hour" value={activity.events_last_hour} />
          <MiniStat label="Outreach last hour" value={activity.outbound_last_hour} />
          <MiniStat label="Needs review" value={activity.reviews_pending} />
        </div>
        <div className="relative mt-6 grid h-28 grid-cols-12 items-end gap-1 overflow-hidden rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3">
          <span className="agent-work-sweep" aria-hidden="true" />
          {Array.from({ length: 12 }, (_, index) => {
            const height = 18 + ((activity.events_last_hour + index * 7) % 58);
            const delay = `${index * 80}ms`;
            return (
              <span
                key={index}
                className="relative z-10 animate-pulse rounded-t-[4px] bg-[var(--color-accent)]/70"
                style={{ height: `${height}%`, animationDelay: delay }}
              />
            );
          })}
        </div>
      </div>

      <aside className="section-note h-fit">
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          System activity
        </p>
        <div className="mt-4 grid gap-2">
          {activity.event_types.length === 0 ? (
            <p className="text-sm leading-6 text-[var(--color-text-3)]">
              No event activity in the last hour.
            </p>
          ) : (
            activity.event_types.map((event) => (
              <div
                key={event.event_type}
                className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2"
              >
                <span className="truncate text-xs text-[var(--color-text-2)]">
                  {event.event_type.replace(/\./g, " ")}
                </span>
                <span className="font-mono text-xs text-[var(--color-text-3)]">
                  {event.count}
                </span>
              </div>
            ))
          )}
        </div>
      </aside>
    </section>
  );
}

function agentCurrentWork(activity: AgentActivity): string {
  if (activity.active_workflows > 0 && activity.outbound_last_hour > 0) {
    return `Processing ${activity.active_workflows} active workflow${activity.active_workflows === 1 ? "" : "s"} and moving ${activity.outbound_last_hour} outreach item${activity.outbound_last_hour === 1 ? "" : "s"} from the last hour.`;
  }
  if (activity.active_workflows > 0) {
    return `Processing ${activity.active_workflows} active workflow${activity.active_workflows === 1 ? "" : "s"} across signal qualification, contact verification, and outreach gates.`;
  }
  if (activity.reviews_pending > 0) {
    return `${activity.reviews_pending} outreach item${activity.reviews_pending === 1 ? " is" : "s are"} waiting for review.`;
  }
  if (activity.events_last_hour > 0) {
    return `${activity.events_last_hour} system event${activity.events_last_hour === 1 ? "" : "s"} landed in the last hour; no outbound send is currently in motion.`;
  }
  return "No active workflow right now. The agent will wake when a qualified signal, reply, or channel event arrives.";
}

function AgentOutreachPanel({
  outreach,
}: {
  outreach: AgentOutreachSummary;
}) {
  return (
    <div id="outreach">
      <SurfaceSection
        title="Sent outreach"
        action={
          <Link href="/dashboard/conversations" className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            Open trace
          </Link>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="grid gap-2 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Agent outreach, last 7 days
            </p>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              <MiniStat label="Emails sent" value={outreach.email_sent_7d} />
              <MiniStat label="DMs sent" value={outreach.linkedin_sent_7d} />
              <MiniStat label="Awaiting reply" value={outreach.awaiting_reply} />
            </div>
            <p className="text-xs leading-5 text-[var(--color-text-3)]">
              Qualified signals become verified contacts, then judged email or
              LinkedIn drafts. Click any contact to inspect the sent draft.
            </p>
          </aside>

          {outreach.recent.length === 0 ? (
            <EmptyState
              title="No sent outreach yet"
              hint="When the agent sends an email or LinkedIn touch, the contact and draft will appear here."
              cta={{
                href: "/dashboard/settings#linkedin",
                label: "Connect accounts",
                icon: "account_tree",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {outreach.recent.map((message) => (
                <AgentOutreachLink key={message.id} message={message} />
              ))}
            </div>
          )}
        </div>
      </SurfaceSection>
    </div>
  );
}

function AgentOutreachLink({ message }: { message: AgentOutreachRow }) {
  return (
    <Link
      href={sentDraftHref(message.conversation_id, message.id)}
      prefetch={false}
      className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={message.channel === "email" ? "mail" : "forum"} size={17} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {message.counterparty_name ?? "Unknown contact"}
            {message.company_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {message.company_name}
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {message.subject ?? messagePreview(message)}
          </span>
          {message.body ? (
            <span className="mt-1 block truncate text-xs text-[var(--color-text-3)]">
              {messagePreview(message)}
            </span>
          ) : null}
          {message.signal_title ? (
            <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
              Why now: {message.signal_title}
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 md:justify-end">
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {channelLabel(message.channel)}
        </span>
        <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
          {statusLabel(message.status)}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(message.sent_at ?? message.created_at)}
        </span>
      </span>
    </Link>
  );
}

function sentDraftHref(conversationId: string, messageId: string): string {
  return `/dashboard/conversations/${conversationId}#message-${messageId}`;
}

function RepCard({
  rep,
  coverage,
}: {
  rep: RepRow;
  coverage: ChannelCoverage;
}) {
  const emailPolicy = rep.autonomy?.channels?.email;
  const linkedInPolicy = firstChannelPolicy(rep, ["linkedin_dm", "linkedin"]);
  return (
    <article className="group grid gap-5 rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-5 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)]/50">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={repIcon(rep)} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/dashboard/agent/${rep.id}`}
              className="text-[18px] font-semibold text-[var(--color-text-1)] transition-colors hover:text-[var(--color-accent)]"
            >
              {agentDisplayName(rep.role)}
            </Link>
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2 py-1 text-[11px] text-[var(--color-text-3)]">
              {rep.role.replace(/_/g, " ")}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
            {rep.persona.story ??
              "Configure this agent with a clear voice and launch guardrails."}
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <MiniStat label="Open" value={Number(rep.open_conversations)} />
        <MiniStat label="Sent 7d" value={Number(rep.sent_7d)} />
        <MiniStat label="Replies 7d" value={Number(rep.outcomes_7d)} />
      </div>
      <div className="grid gap-2 border-t border-[var(--color-line-1)] pt-3 sm:grid-cols-2">
        <RepChannelPill
          title="Email"
          icon="mail"
          connection={coverage.email}
          policy={emailPolicy}
        />
        <RepChannelPill
          title="LinkedIn"
          icon="forum"
          connection={coverage.linkedIn}
          policy={linkedInPolicy}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--color-text-3)]">
        <span>
          {statusLabel(rep.status)} / Profile, accounts, and limits stay in
          Profile
        </span>
        <Link href={`/dashboard/agent/${rep.id}`} className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Open agent
        </Link>
      </div>
    </article>
  );
}

function RepChannelPill({
  title,
  icon,
  connection,
  policy,
}: {
  title: string;
  icon: string;
  connection: ChannelConnection;
  policy?: RepChannelPolicy;
}) {
  const cap = policy?.daily_cap ?? connection.dailyCap ?? 0;
  const approval = policy?.approval ?? "not set";
  return (
    <Link
      href={connection.href}
      prefetch={false}
      className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 transition-colors hover:border-[var(--color-line-3)]"
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--color-text-1)]">
          <Icon name={icon} size={14} />
          {title}
        </span>
        <span
          className={
            "rounded-[8px] px-2 py-1 text-[11px] font-medium " +
            (connection.connected
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : "bg-[var(--color-ink-0)] text-[var(--color-text-3)]")
          }
        >
          {connection.connected ? "Ready" : "Connect"}
        </span>
      </span>
      <span className="mt-2 block truncate text-xs text-[var(--color-text-3)]">
        {connection.label}
      </span>
      <span className="mt-1 block text-[11px] leading-5 text-[var(--color-text-3)]">
        {cap > 0 ? `${cap}/day` : "No cap"} - {approvalLabel(approval)}
      </span>
    </Link>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2">
      <strong className="block text-lg font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-0.5 block text-[11px] text-[var(--color-text-3)]">
        {label}
      </span>
    </span>
  );
}

function workspaceChannelCoverage(channels: ChannelRow[]): ChannelCoverage {
  const email = firstByReadiness(
    channels.filter((channel) => channel.kind === "oauth_outlook"),
  );
  const linkedIn = firstByReadiness(
    channels.filter(
      (channel) =>
        channel.kind === "linkedin_session" || channel.kind === "linkedin_oauth",
    ),
  );
  return {
    email: channelConnection(email, "Connect Outlook", "/dashboard/settings#email"),
    linkedIn: channelConnection(
      linkedIn,
      "Connect LinkedIn",
      "/dashboard/settings#linkedin",
    ),
  };
}

function firstByReadiness(channels: ChannelRow[]): ChannelRow | undefined {
  return channels.find((channel) => channel.status === "connected") ?? channels[0];
}

function channelConnection(
  channel: ChannelRow | undefined,
  fallback: string,
  href: string,
): ChannelConnection {
  if (!channel) {
    return {
      connected: false,
      label: fallback,
      status: "needed",
      dailyCap: null,
      href,
    };
  }
  return {
    connected: channel.status === "connected",
    label: channel.display_name,
    status: channel.status,
    dailyCap: channel.daily_cap,
    href,
  };
}

function firstChannelPolicy(
  rep: RepRow,
  keys: string[],
): RepChannelPolicy | undefined {
  const channels = rep.autonomy?.channels;
  if (!channels) return undefined;
  for (const key of keys) {
    const policy = channels[key];
    if (policy) return policy;
  }
  return undefined;
}

function isVisibleProductAgent(rep: RepRow): boolean {
  return rep.role === "sdr";
}

function fallbackSequenceFromReps(reps: RepRow[]): AgentSequenceStep[] {
  const rep = reps[0];
  if (!rep) return [];
  const emailPolicy = rep.autonomy?.channels?.email;
  const linkedInPolicy = firstChannelPolicy(rep, ["linkedin_dm", "linkedin"]);
  const sequence: AgentSequenceStep[] = [];
  if (emailPolicy) {
    sequence.push({
      id: `${rep.id}:email`,
      name: "Qualified signal email",
      channel: "email",
      declaration:
        "When a Signal matches the ICP, research the account, draft a judged email, and wait for the configured channel gate.",
      status: rep.status,
      daily_cap: emailPolicy.daily_cap ?? null,
      approval: emailPolicy.approval ?? null,
      steps: [
        "research.signal_context",
        "writer.compose_email",
        "eval.hot_path",
        "approval.channel_gate",
        "sender.email",
      ],
    });
  }
  if (linkedInPolicy) {
    sequence.push({
      id: `${rep.id}:linkedin`,
      name: "Qualified signal LinkedIn touch",
      channel: "linkedin_dm",
      declaration:
        "When email is not the best path or a LinkedIn profile is ready, draft a judged LinkedIn touch and apply channel limits.",
      status: rep.status,
      daily_cap: linkedInPolicy.daily_cap ?? null,
      approval: linkedInPolicy.approval ?? null,
      steps: [
        "research.signal_context",
        "writer.compose_linkedin",
        "eval.hot_path",
        "approval.channel_gate",
        "sender.linkedin",
      ],
    });
  }
  return sequence;
}

function repIcon(_rep: RepRow): string {
  return "badge";
}

function agentDisplayName(role: string): string {
  if (role === "sdr") return "Outbound agent";
  return "Agent";
}

function approvalLabel(value: string): string {
  if (value === "none") return "Autonomous after checks";
  if (value === "always") return "Review every move";
  if (value === "approve_first") return "Review first move";
  if (value === "research_only") return "Research only";
  return value.replace(/_/g, " ");
}

function statusLabel(status: string): string {
  if (status === "active") return "Active";
  if (status === "connected") return "Connected";
  if (status === "needs_reauth") return "Needs reauth";
  return status.replace(/_/g, " ");
}

function messagePreview(message: AgentOutreachRow): string {
  const text = message.body;
  if (!text) return "Sent draft";
  return text.length > 96 ? text.slice(0, 96) + "..." : text;
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

function channelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin_dm") return "LinkedIn DM";
  if (channel === "linkedin_inmail") return "LinkedIn InMail";
  if (channel === "linkedin_connection") return "LinkedIn connect";
  if (channel === "linkedin_comment") return "LinkedIn comment";
  return channel.replace(/_/g, " ");
}

function sequenceStepFromPlay(row: {
  id: string;
  name: string;
  declaration: string;
  compiled: Record<string, unknown>;
  autonomy: Record<string, unknown>;
  status: string;
}): AgentSequenceStep {
  const channel = stringValue(row.compiled.channel) ?? "email";
  const channelPolicy = policyFromAutonomy(row.autonomy, channel);
  return {
    id: row.id,
    name: row.name,
    channel,
    declaration: row.declaration,
    status: row.status,
    daily_cap: numberValue(channelPolicy?.daily_cap),
    approval: stringValue(channelPolicy?.approval),
    steps: stepsFromCompiled(row.compiled),
  };
}

function policyFromAutonomy(
  autonomy: Record<string, unknown>,
  channel: string,
): Record<string, unknown> | null {
  const channels = recordValue(autonomy.channels);
  if (!channels) return null;
  return recordValue(channels[channel]);
}

function stepsFromCompiled(compiled: Record<string, unknown>): string[] {
  const steps = Array.isArray(compiled.steps) ? compiled.steps : [];
  return steps
    .map((step) => recordValue(step))
    .filter((step): step is Record<string, unknown> => Boolean(step))
    .map((step) => stringValue(step.op) ?? stringValue(step.id))
    .filter((value): value is string => Boolean(value))
    .slice(0, 5);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setupLines(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      const record = recordValue(item);
      return (
        stringValue(record?.label) ??
        stringValue(record?.title) ??
        stringValue(record?.value) ??
        stringValue(record?.text)
      );
    })
    .filter((item): item is string => Boolean(item));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function nextRunLabel(lastPolled: Date | null, cadenceSeconds: number): string {
  if (!lastPolled) return "Ready now";
  const nextAt = new Date(lastPolled).getTime() + cadenceSeconds * 1000;
  const diff = nextAt - Date.now();
  if (diff <= 0) return "Ready now";
  const minutes = Math.ceil(diff / 60_000);
  if (minutes < 60) return `Next in ${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `Next in ${hours}h`;
  return `Next in ${Math.ceil(hours / 24)}d`;
}

function NoWorkspaceReps() {
  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Agent"
        title="Create a workspace."
        description="The agent needs a workspace profile, channels, and launch guardrails before it can act."
      />
      <EmptyState
        title="No workspace selected."
        hint="Create or select a workspace before configuring the agent."
        cta={{
          href: "/dashboard/settings#profile",
          label: "Start setup",
          icon: "add_business",
        }}
      />
    </div>
  );
}
