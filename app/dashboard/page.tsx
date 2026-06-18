import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { EmptyState } from "@/components/dashboard/Shell";
import { SurfaceSection } from "@/components/dashboard/SurfaceHero";

export const metadata: Metadata = {
  title: "Brief | Bombsell",
};

export const dynamic = "force-dynamic";

interface BriefActionState {
  pending_reviews: number;
  unhealthy_channels: number;
  bounced_24h: number;
  useful_outcomes_7d: number;
  meetings_7d: number;
  qualified_signals_24h: number;
  qualified_signals_7d: number;
  emails_sent_24h: number;
  emails_sent_7d: number;
  dms_sent_24h: number;
  dms_sent_7d: number;
  replies_24h: number;
  replies_7d: number;
  meetings_24h: number;
}

interface SignalKindMetric {
  kind: string;
  count_24h: number;
  count_7d: number;
}

interface BriefSignalHealth {
  active_sources: number;
  watched_sources: number;
  productive_sources_7d: number;
  quiet_sources: number;
  attention_source_name: string | null;
  attention_reason: string | null;
}

interface BriefOutcomeInsight {
  id: string;
  kind: string;
  occurred_at: Date;
  conversation_id: string | null;
  attributed_message_id: string | null;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  message_subject: string | null;
  reply_intent: string | null;
}

interface BriefLearningInsight {
  strategy_summary: string | null;
  strategy_updated_at: Date | null;
  skill_summary: string | null;
  skill_updated_at: Date | null;
  recommended_patterns: number;
  useful_outcomes_30d: number;
}

interface BriefHotContact {
  id: string;
  full_name: string;
  title: string | null;
  emails: string[];
  linkedin_url: string | null;
  company_name: string | null;
  company_domain: string | null;
  latest_signal_title: string;
  latest_signal_kind: string;
  last_signal_at: Date;
  contact_fit_decision: string | null;
}

interface BriefNextMove {
  icon: string;
  title: string;
  detail: string;
  href: string;
  action: string;
  tone: "ready" | "attention" | "neutral";
}

async function loadBriefActionState(workspaceId: string): Promise<BriefActionState> {
  const pool = getPool();
  const { rows } = await pool.query<{
    pending_reviews: string;
    unhealthy_channels: string;
    bounced_24h: string;
    useful_outcomes_7d: string;
    meetings_7d: string;
    qualified_signals_24h: string;
    qualified_signals_7d: string;
    emails_sent_24h: string;
    emails_sent_7d: string;
    dms_sent_24h: string;
    dms_sent_7d: string;
    replies_24h: string;
    replies_7d: string;
    meetings_24h: string;
  }>(
    `with outlook_accounts as (
       select coalesce(
                nullif(lower(ca.properties ->> 'mailbox_email'), ''),
                nullif(lower(ca.display_name), ''),
                ca.id::text
              ) as outlook_mailbox_key,
              ca.status,
              ca.last_error
         from channel_accounts ca
        where ca.workspace_id = $1
          and ca.kind = 'oauth_outlook'
     ),
     outlook_mailboxes as (
       select outlook_mailbox_key,
              bool_or(status = 'connected') as has_connected,
              bool_or(status = 'connected' and last_error is not null) as has_connected_error,
              bool_or(status::text in (
                'needs_reauth',
                'errored',
                'error',
                'rate_limited',
                'suspended',
                'disconnected'
              )) as has_blocked_status
         from outlook_accounts
        group by outlook_mailbox_key
     )
     select
       (select count(*)::text from workflow_approvals a
          where a.workspace_id = $1
            and a.decision = 'pending') as pending_reviews,
       ((select count(*) from outlook_mailboxes
          where has_connected_error
             or (has_blocked_status and not has_connected))
        + (select count(*) from channel_accounts ca
             where ca.workspace_id = $1
               and ca.kind in ('email_domain','linkedin_oauth','linkedin_session')
               and (
                 ca.status::text in ('needs_reauth','errored','error','rate_limited','suspended','disconnected')
                 or ca.last_error is not null
               )))::text as unhealthy_channels,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.status = 'bounced'
            and m.sent_at >= now() - interval '24 hours') as bounced_24h,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as useful_outcomes_7d,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'meeting_booked'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as meetings_7d,
       (select count(*)::text from signals s
          where s.workspace_id = $1
            and s.status in ('matched','in_play')
            and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '24 hours') as qualified_signals_24h,
       (select count(*)::text from signals s
          where s.workspace_id = $1
            and s.status in ('matched','in_play')
            and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as qualified_signals_7d,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel = 'email'
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '24 hours') as emails_sent_24h,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel = 'email'
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as emails_sent_7d,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel in ('linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '24 hours') as dms_sent_24h,
       (select count(*)::text from messages m
          where m.workspace_id = $1
            and m.direction = 'outbound'
            and m.channel in ('linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
            and m.status in ('sent','delivered','replied')
            and coalesce(m.sent_at, m.created_at) >= now() - interval '7 days') as dms_sent_7d,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'positive_reply'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '24 hours') as replies_24h,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'positive_reply'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as replies_7d,
       (select count(*)::text from outcomes o
          where o.workspace_id = $1
            and o.kind = 'meeting_booked'
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '24 hours') as meetings_24h`,
    [workspaceId],
  );
  return {
    pending_reviews: Number(rows[0]?.pending_reviews ?? 0),
    unhealthy_channels: Number(rows[0]?.unhealthy_channels ?? 0),
    bounced_24h: Number(rows[0]?.bounced_24h ?? 0),
    useful_outcomes_7d: Number(rows[0]?.useful_outcomes_7d ?? 0),
    meetings_7d: Number(rows[0]?.meetings_7d ?? 0),
    qualified_signals_24h: Number(rows[0]?.qualified_signals_24h ?? 0),
    qualified_signals_7d: Number(rows[0]?.qualified_signals_7d ?? 0),
    emails_sent_24h: Number(rows[0]?.emails_sent_24h ?? 0),
    emails_sent_7d: Number(rows[0]?.emails_sent_7d ?? 0),
    dms_sent_24h: Number(rows[0]?.dms_sent_24h ?? 0),
    dms_sent_7d: Number(rows[0]?.dms_sent_7d ?? 0),
    replies_24h: Number(rows[0]?.replies_24h ?? 0),
    replies_7d: Number(rows[0]?.replies_7d ?? 0),
    meetings_24h: Number(rows[0]?.meetings_24h ?? 0),
  };
}

async function loadSignalKindMetrics(workspaceId: string): Promise<SignalKindMetric[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    kind: string;
    count_24h: string;
    count_7d: string;
  }>(
    `select s.kind::text as kind,
            count(*) filter (
              where coalesce(s.ingested_at, s.freshness_at) >= now() - interval '24 hours'
            )::text as count_24h,
            count(*) filter (
              where coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
            )::text as count_7d
       from signals s
      where s.workspace_id = $1
        and s.status in ('matched','in_play')
        and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days'
      group by s.kind
      order by count(*) desc, s.kind asc
      limit 6`,
    [workspaceId],
  );
  return rows.map((row) => ({
    kind: row.kind,
    count_24h: Number(row.count_24h),
    count_7d: Number(row.count_7d),
  }));
}

async function loadBriefSignalHealth(
  workspaceId: string,
): Promise<BriefSignalHealth> {
  const pool = getPool();
  const { rows } = await pool.query<{
    active_sources: string;
    watched_sources: string;
    productive_sources_7d: string;
    quiet_sources: string;
    attention_source_name: string | null;
    attention_reason: string | null;
  }>(
    `with source_rows as (
       select gs.id,
              gs.name,
              (wsc.enabled and gs.enabled) as enabled,
              coalesce(wsc.last_polled_at, gs.last_polled_at) as last_polled_at,
              wsc.last_error,
              (select count(*)::int
                 from signals s
                where s.workspace_id = $1
                  and s.source_id = gs.id
                  and s.status in ('matched','in_play')
                  and coalesce(s.ingested_at, s.freshness_at) >= now() - interval '7 days') as matched_week
         from workspace_source_configs wsc
         join graph_sources gs
           on gs.workspace_id = wsc.workspace_id
          and gs.id = wsc.source_id
        where wsc.workspace_id = $1
     ),
     attention as (
       select name,
              case
                when last_error is not null then 'source error'
                when enabled and matched_week = 0 then 'no qualified signals this week'
                else null
              end as reason
         from source_rows
        where last_error is not null
           or (enabled and matched_week = 0)
        order by case when last_error is not null then 0 else 1 end,
                 coalesce(last_polled_at, '-infinity'::timestamptz) desc,
                 name asc
        limit 1
     )
     select count(*) filter (where enabled)::text as active_sources,
            count(*)::text as watched_sources,
            count(*) filter (where enabled and matched_week > 0)::text as productive_sources_7d,
            count(*) filter (where enabled and matched_week = 0)::text as quiet_sources,
            (select name from attention) as attention_source_name,
            (select reason from attention) as attention_reason
       from source_rows`,
    [workspaceId],
  );
  const row = rows[0];
  return {
    active_sources: Number(row?.active_sources ?? 0),
    watched_sources: Number(row?.watched_sources ?? 0),
    productive_sources_7d: Number(row?.productive_sources_7d ?? 0),
    quiet_sources: Number(row?.quiet_sources ?? 0),
    attention_source_name: row?.attention_source_name ?? null,
    attention_reason: row?.attention_reason ?? null,
  };
}

async function loadBriefHotContacts(workspaceId: string): Promise<BriefHotContact[]> {
  const pool = getPool();
  const { rows } = await pool.query<BriefHotContact>(
    `select p.id,
            p.full_name,
            p.title,
            coalesce(p.emails, '{}'::text[]) as emails,
            p.linkedin_url,
            co.name as company_name,
            co.domain::text as company_domain,
            latest_signal.title as latest_signal_title,
            latest_signal.kind as latest_signal_kind,
            latest_signal.signal_at as last_signal_at,
            p.properties #>> '{contact_fit,decision}' as contact_fit_decision
       from graph_persons p
       left join graph_companies co on co.id = p.company_id
       join lateral (
         select s.title,
                s.kind::text as kind,
                coalesce(s.ingested_at, s.freshness_at) as signal_at
           from signals s
          where s.workspace_id = $1
            and s.status in ('matched','in_play')
            and (
              s.related_person_id = p.id
              or (p.company_id is not null and s.related_company_id = p.company_id)
            )
          order by coalesce(s.ingested_at, s.freshness_at) desc
          limit 1
       ) latest_signal on true
      where p.workspace_id = $1
        and (cardinality(coalesce(p.emails, '{}'::text[])) > 0 or p.linkedin_url is not null)
      order by latest_signal.signal_at desc
      limit 4`,
    [workspaceId],
  );
  return rows;
}

async function loadBriefOutcomeInsights(
  workspaceId: string,
): Promise<BriefOutcomeInsight[]> {
  const pool = getPool();
  const { rows } = await pool.query<BriefOutcomeInsight>(
    `select o.id,
            o.kind::text as kind,
            coalesce(o.recorded_at, o.occurred_at) as occurred_at,
            o.conversation_id,
            o.attributed_message_id,
            p.full_name as counterparty_name,
            co.name as company_name,
            s.title as signal_title,
            m.subject as message_subject,
            o.properties->>'reply_intent' as reply_intent
       from outcomes o
       left join conversations c on c.id = o.conversation_id
       left join graph_persons p on p.id = coalesce(o.subject_person_id, c.counterparty_person_id)
       left join graph_companies co on co.id = coalesce(o.subject_company_id, c.counterparty_company_id)
       left join signals s on s.id = coalesce(o.attributed_signal_id, c.origin_signal_id)
       left join messages m on m.id = o.attributed_message_id
      where o.workspace_id = $1
        and o.kind in ('positive_reply','meeting_booked')
        and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days'
      order by coalesce(o.recorded_at, o.occurred_at) desc
      limit 5`,
    [workspaceId],
  );
  return rows;
}

async function loadBriefLearningInsight(
  workspaceId: string,
): Promise<BriefLearningInsight> {
  const pool = getPool();
  const [outcomes, events] = await Promise.all([
    pool.query<{ useful_outcomes_30d: string }>(
      `select count(*)::text as useful_outcomes_30d
         from outcomes o
        where o.workspace_id = $1
          and o.kind in ('positive_reply','opportunity_created','meeting_booked','deal_won')
          and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '30 days'`,
      [workspaceId],
    ),
    pool.query<{
      event_type: string;
      payload: unknown;
      occurred_at: Date;
    }>(
      `select event_type, payload, occurred_at
         from events
        where workspace_id = $1
          and event_type in (
            'campaign.strategy.recommended',
            'play.skill.optimization.recommended'
          )
        order by occurred_at desc
        limit 6`,
      [workspaceId],
    ),
  ]);
  const latestStrategy = events.rows.find(
    (event) => event.event_type === "campaign.strategy.recommended",
  );
  const latestSkill = events.rows.find(
    (event) => event.event_type === "play.skill.optimization.recommended",
  );
  const strategy = recordPayload(latestStrategy?.payload);
  const skill = recordPayload(latestSkill?.payload);
  return {
    strategy_summary: stringPayload(strategy, "summary"),
    strategy_updated_at: latestStrategy?.occurred_at ?? null,
    skill_summary: stringPayload(skill, "summary"),
    skill_updated_at: latestSkill?.occurred_at ?? null,
    recommended_patterns:
      arrayPayloadLength(skill, "recommendations") ||
      arrayPayloadLength(strategy, "variants"),
    useful_outcomes_30d: Number(outcomes.rows[0]?.useful_outcomes_30d ?? 0),
  };
}

const EMPTY_ACTION_STATE: BriefActionState = {
  pending_reviews: 0,
  unhealthy_channels: 0,
  bounced_24h: 0,
  useful_outcomes_7d: 0,
  meetings_7d: 0,
  qualified_signals_24h: 0,
  qualified_signals_7d: 0,
  emails_sent_24h: 0,
  emails_sent_7d: 0,
  dms_sent_24h: 0,
  dms_sent_7d: 0,
  replies_24h: 0,
  replies_7d: 0,
  meetings_24h: 0,
};

const EMPTY_LEARNING_INSIGHT: BriefLearningInsight = {
  strategy_summary: null,
  strategy_updated_at: null,
  skill_summary: null,
  skill_updated_at: null,
  recommended_patterns: 0,
  useful_outcomes_30d: 0,
};

const EMPTY_SIGNAL_HEALTH: BriefSignalHealth = {
  active_sources: 0,
  watched_sources: 0,
  productive_sources_7d: 0,
  quiet_sources: 0,
  attention_source_name: null,
  attention_reason: null,
};

export default async function BriefPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return (
      <BriefView
        actions={EMPTY_ACTION_STATE}
        signalKinds={[]}
        signalHealth={EMPTY_SIGNAL_HEALTH}
        hotContacts={[]}
        outcomeInsights={[]}
        learning={EMPTY_LEARNING_INSIGHT}
        workspaceName="there"
      />
    );
  }
  const {
    actions,
    signalKinds,
    signalHealth,
    hotContacts,
    outcomeInsights,
    learning,
  } = await loadBriefState(session.workspace.id);
  return (
    <BriefView
      actions={actions}
      signalKinds={signalKinds}
      signalHealth={signalHealth}
      hotContacts={hotContacts}
      outcomeInsights={outcomeInsights}
      learning={learning}
      workspaceName={session.workspace.name}
    />
  );
}

async function loadBriefState(
  workspaceId: string,
): Promise<{
  actions: BriefActionState;
  signalKinds: SignalKindMetric[];
  signalHealth: BriefSignalHealth;
  hotContacts: BriefHotContact[];
  outcomeInsights: BriefOutcomeInsight[];
  learning: BriefLearningInsight;
}> {
  try {
    const [
      actions,
      signalKinds,
      signalHealth,
      hotContacts,
      outcomeInsights,
      learning,
    ] =
      await Promise.all([
        loadBriefActionState(workspaceId),
        loadSignalKindMetrics(workspaceId),
        loadBriefSignalHealth(workspaceId),
        loadBriefHotContacts(workspaceId),
        loadBriefOutcomeInsights(workspaceId),
        loadBriefLearningInsight(workspaceId),
      ]);
    return {
      actions,
      signalKinds,
      signalHealth,
      hotContacts,
      outcomeInsights,
      learning,
    };
  } catch (err) {
    console.error("[dashboard/brief] failed to load brief state", err);
    return {
      actions: EMPTY_ACTION_STATE,
      signalKinds: [],
      signalHealth: EMPTY_SIGNAL_HEALTH,
      hotContacts: [],
      outcomeInsights: [],
      learning: EMPTY_LEARNING_INSIGHT,
    };
  }
}

function BriefView({
  actions,
  signalKinds,
  signalHealth,
  hotContacts,
  outcomeInsights,
  learning,
  workspaceName,
}: {
  actions: BriefActionState;
  signalKinds: SignalKindMetric[];
  signalHealth: BriefSignalHealth;
  hotContacts: BriefHotContact[];
  outcomeInsights: BriefOutcomeInsight[];
  learning: BriefLearningInsight;
  workspaceName: string;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const totalSent24h = actions.emails_sent_24h + actions.dms_sent_24h;
  const totalSent7d = actions.emails_sent_7d + actions.dms_sent_7d;
  const replyRate =
    totalSent7d > 0 ? Math.round((actions.replies_7d / totalSent7d) * 100) : 0;
  const priority = briefPriority(actions, totalSent7d);
  const nextMoves = briefNextMoves(
    actions,
    signalHealth,
    hotContacts.length,
    learning,
    totalSent7d,
  );

  return (
    <div className="space-y-8">
      <section className="rounded-[12px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 sm:p-7">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          {today}
        </p>
        <h1
          className="mt-4 text-[2rem] font-semibold leading-tight text-[var(--color-text-1)] sm:text-[3rem]"
          style={{ fontFamily: "var(--font-display)", letterSpacing: 0 }}
        >
          Welcome back, {workspaceName}.
        </h1>
        <p className="mt-3 max-w-[72ch] text-[15px] leading-7 text-[var(--color-text-2)]">
          Your agent found {actions.qualified_signals_24h} qualified signals in
          the last day, sent {totalSent24h} emails or LinkedIn DMs, and produced{" "}
          {actions.replies_24h} replies with {actions.meetings_24h} meetings.
        </p>
      </section>

      <BriefSnapshotPanel
        actions={actions}
        signalKinds={signalKinds}
        signalHealth={signalHealth}
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--color-text-1)]">
                Today priority
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
                {priority.detail}
              </p>
            </div>
            <Link href={priority.href} className="btn-solid-sm w-fit">
              <Icon name={priority.icon} size={14} />
              {priority.label}
            </Link>
          </div>
        </div>

        <aside className="section-note">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Agent insight
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-3)]">
            {totalSent7d === 0
              ? "No outbound volume in the last week. Connect Outlook or LinkedIn, then let qualified signals become verified contacts and judged drafts."
              : `${totalSent7d} emails or DMs went out in the last week. ${actions.replies_7d} got useful replies, ${actions.meetings_7d} became meetings, and the current reply rate is ${replyRate}%.`}
          </p>
          <Link href="/dashboard/agent#outreach" className="btn-solid-sm mt-4 w-fit">
            <Icon name="arrow_forward" size={14} />
            Open Agent
          </Link>
        </aside>
      </section>

      <BriefNextMovesPanel moves={nextMoves} />

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <SurfaceSection
          title="Fresh qualified contacts"
          action={
            <Link href="/dashboard/agent#verified-contacts" className="btn-quiet-sm">
              <Icon name="arrow_forward" size={14} />
              View contacts
            </Link>
          }
        >
          {hotContacts.length === 0 ? (
            <EmptyState
              title="No signal-backed contacts yet"
              hint="Once qualified signals resolve to verified emails or LinkedIn profiles, the freshest people will appear here."
              cta={{
                href: "/dashboard/agent#opportunities",
                label: "Review signals",
                icon: "person_search",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {hotContacts.map((contact) => (
                <BriefHotContactRow key={contact.id} contact={contact} />
              ))}
            </div>
          )}
        </SurfaceSection>

        <ReplySnapshotCard actions={actions} totalSent7d={totalSent7d} />
      </section>

      <div id="weekly-learning" className="scroll-mt-28">
        <SurfaceSection
          title="Weekly learning"
          action={
            <Link href="/dashboard/agent#learning" className="btn-quiet-sm">
              <Icon name="auto_graph" size={14} />
              Open learning
            </Link>
          }
        >
          <BriefLearningPanel learning={learning} />
        </SurfaceSection>
      </div>

      <div id="reply-insights" className="scroll-mt-28">
        <SurfaceSection title="Reply and meeting insights">
          {outcomeInsights.length === 0 ? (
            <EmptyState
              title="No replies or meetings this week"
              hint="Once outreach lands, the brief will show the person, company, signal, and exact conversation behind each reply or meeting."
              cta={{
                href: "/dashboard/agent#outreach",
                label: "Review outreach",
                icon: "mail",
              }}
            />
          ) : (
            <div className="grid gap-2">
              {outcomeInsights.map((insight) => (
                <OutcomeInsightRow key={insight.id} insight={insight} />
              ))}
            </div>
          )}
        </SurfaceSection>
      </div>
    </div>
  );
}

function BriefNextMovesPanel({ moves }: { moves: BriefNextMove[] }) {
  return (
    <section className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 sm:grid-cols-3">
      {moves.map((move) => (
        <Link
          key={move.title}
          href={move.href}
          prefetch={false}
          className="group grid min-h-[138px] gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-3)]"
        >
          <span className="flex items-start justify-between gap-3">
            <span
              className={
                "grid size-9 place-items-center rounded-[8px] " +
                briefMoveToneClass(move.tone)
              }
            >
              <Icon name={move.icon} size={17} />
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]">
              {move.action}
              <Icon
                name="arrow_forward"
                size={13}
                className="transition-transform group-hover:translate-x-0.5"
              />
            </span>
          </span>
          <span>
            <span className="block text-sm font-semibold text-[var(--color-text-1)]">
              {move.title}
            </span>
            <span className="mt-2 line-clamp-3 block text-xs leading-5 text-[var(--color-text-3)]">
              {move.detail}
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}

function briefMoveToneClass(tone: BriefNextMove["tone"]): string {
  if (tone === "ready") return "bg-[var(--color-pos-bg)] text-[var(--color-pos)]";
  if (tone === "attention") return "bg-[var(--color-warn-bg)] text-[var(--color-warn)]";
  return "bg-[var(--color-ink-0)] text-[var(--color-text-2)]";
}

function BriefSnapshotPanel({
  actions,
  signalKinds,
  signalHealth,
}: {
  actions: BriefActionState;
  signalKinds: SignalKindMetric[];
  signalHealth: BriefSignalHealth;
}) {
  const metrics = [
    {
      icon: "sensors",
      label: "Qualified signals",
      day: actions.qualified_signals_24h,
      week: actions.qualified_signals_7d,
      href: "/dashboard/agent#opportunities",
    },
    {
      icon: "mail",
      label: "Emails sent",
      day: actions.emails_sent_24h,
      week: actions.emails_sent_7d,
      href: "/dashboard/agent#outreach",
    },
    {
      icon: "linkedin",
      label: "LinkedIn DMs",
      day: actions.dms_sent_24h,
      week: actions.dms_sent_7d,
      href: "/dashboard/agent#outreach",
    },
    {
      icon: "mark_email_read",
      label: "Replies",
      day: actions.replies_24h,
      week: actions.replies_7d,
      href: "/dashboard/brief#reply-insights",
    },
    {
      icon: "event_available",
      label: "Meetings",
      day: actions.meetings_24h,
      week: actions.meetings_7d,
      href: "/dashboard/brief#reply-insights",
    },
  ];
  return (
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Last day and week
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--color-text-3)]">
              The operating brief only tracks qualified signals, sent outreach,
              replies, and meetings.
            </p>
          </div>
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-3)]">
            24h / 7d
          </span>
        </div>
        <div className="mt-4 grid gap-2">
          {metrics.map((metric) => (
            <BriefWindowMetricRow key={metric.label} metric={metric} />
          ))}
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              Signal types
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
              Qualified timing evidence by type.
            </p>
          </div>
          <Link href="/dashboard/agent#opportunities" className="btn-quiet-sm">
            <Icon name="arrow_forward" size={14} />
            Open signals
          </Link>
        </div>
        {signalKinds.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No qualified signal types yet"
              hint="Complete Profile and connect accounts so the agent can start qualifying timing evidence."
              cta={{
                href: "/dashboard/profile#profile",
                label: "Open profile",
                icon: "person",
              }}
            />
          </div>
        ) : (
          <div className="mt-4 grid gap-2">
            {signalKinds.map((signal) => (
              <SignalKindRow key={signal.kind} signal={signal} />
            ))}
          </div>
        )}
        <SignalHealthPanel actions={actions} health={signalHealth} />
      </div>
    </section>
  );
}

function SignalHealthPanel({
  actions,
  health,
}: {
  actions: BriefActionState;
  health: BriefSignalHealth;
}) {
  const dailyAverage = actions.qualified_signals_7d / 7;
  const attention = signalHealthAttention(health);
  return (
    <div className="mt-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-1)]">
          <Icon name="monitor_heart" size={15} />
          Signal health
        </p>
        <Link href="/dashboard/agent#sources" className="btn-quiet-sm">
          <Icon name="arrow_forward" size={14} />
          Sources
        </Link>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <SignalHealthMetric
          label="Active sources"
          value={`${health.active_sources}/${health.watched_sources}`}
        />
        <SignalHealthMetric
          label="Productive 7d"
          value={health.productive_sources_7d}
        />
        <SignalHealthMetric
          label="Avg/day"
          value={formatDailyAverage(dailyAverage)}
        />
      </div>
      <p
        className={
          "mt-3 rounded-[8px] px-3 py-2 text-xs leading-5 " +
          (attention
            ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
            : "bg-[var(--color-pos-bg)] text-[var(--color-pos)]")
        }
      >
        {attention ??
          "Signal engine is active. Productive sources are creating qualified timing evidence this week."}
      </p>
    </div>
  );
}

function SignalHealthMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-[8px] bg-[var(--color-ink-0)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-text-4)]">{label}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </p>
    </div>
  );
}

function signalHealthAttention(health: BriefSignalHealth): string | null {
  if (health.watched_sources === 0) {
    return "No signal sources are configured yet. Complete Profile so the Agent can watch for timing evidence.";
  }
  if (health.active_sources === 0) {
    return "Signal sources exist, but none are active. Re-enable sources before qualified signals can flow.";
  }
  if (health.attention_source_name && health.attention_reason) {
    return `${health.attention_source_name} needs attention: ${health.attention_reason}.`;
  }
  if (health.quiet_sources > 0) {
    return `${health.quiet_sources} active source${
      health.quiet_sources === 1 ? " is" : "s are"
    } quiet this week. Review source mix if qualified signals slow down.`;
  }
  return null;
}

function formatDailyAverage(value: number): string {
  if (value === 0) return "0";
  if (value < 1) return value.toFixed(1);
  return String(Math.round(value));
}

function BriefWindowMetricRow({
  metric,
}: {
  metric: {
    icon: string;
    label: string;
    day: number;
    week: number;
    href: string;
  };
}) {
  return (
    <Link
      href={metric.href}
      className="group grid grid-cols-[32px_minmax(0,1fr)_72px_72px] items-center gap-3 rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2 transition-colors hover:bg-[var(--color-ink-3)]"
    >
      <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-0)] text-[var(--color-text-2)]">
        <Icon name={metric.icon} size={15} />
      </span>
      <span className="truncate text-sm font-semibold text-[var(--color-text-1)]">
        {metric.label}
      </span>
      <span className="text-right">
        <span className="block text-[11px] text-[var(--color-text-4)]">24h</span>
        <strong className="block text-base font-semibold tabular-nums text-[var(--color-text-1)]">
          {metric.day}
        </strong>
      </span>
      <span className="text-right">
        <span className="block text-[11px] text-[var(--color-text-4)]">7d</span>
        <strong className="block text-base font-semibold tabular-nums text-[var(--color-text-1)]">
          {metric.week}
        </strong>
      </span>
    </Link>
  );
}

function ReplySnapshotCard({
  actions,
  totalSent7d,
}: {
  actions: BriefActionState;
  totalSent7d: number;
}) {
  const replyRate =
    totalSent7d > 0 ? Math.round((actions.replies_7d / totalSent7d) * 100) : 0;
  return (
    <SurfaceSection title="Replies and meetings">
      <div className="grid gap-3">
        <FunnelStep label="Replies 24h" value={actions.replies_24h} />
        <FunnelStep label="Replies 7d" value={actions.replies_7d} />
        <FunnelStep label="Meetings 24h" value={actions.meetings_24h} />
        <FunnelStep label="Meetings 7d" value={actions.meetings_7d} />
      </div>
      <p className="mt-4 text-sm leading-6 text-[var(--color-text-3)]">
        {totalSent7d === 0
          ? "No reply-rate signal yet because no email or LinkedIn outreach has gone out this week."
          : `${replyRate}% reply rate from ${totalSent7d} emails and DMs in the last week.`}
      </p>
      <Link href="/dashboard/brief#reply-insights" className="btn-quiet-sm mt-4 w-fit">
        <Icon name="arrow_forward" size={14} />
        View insights
      </Link>
    </SurfaceSection>
  );
}

function BriefHotContactRow({ contact }: { contact: BriefHotContact }) {
  const company = contact.company_name ?? contact.company_domain ?? "Unknown company";
  const signalKind = contact.latest_signal_kind.replace(/_/g, " ");
  return (
    <Link
      href={`/dashboard/agent/contacts/${contact.id}`}
      prefetch={false}
      className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-accent-bg)] text-[var(--color-accent)]">
          <Icon name="person_search" size={17} />
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
          <span className="mt-2 block line-clamp-2 text-xs leading-5 text-[var(--color-text-3)]">
            <span className="font-medium text-[var(--color-text-2)]">Why now:</span>{" "}
            {contact.latest_signal_title}
          </span>
          <span className="mt-2 flex flex-wrap gap-2">
            <ContactSignalPill icon="sensors">{signalKind}</ContactSignalPill>
            <ContactSignalPill icon="mail">
              {contact.emails.length > 0 ? "Verified email" : "Email pending"}
            </ContactSignalPill>
            <ContactSignalPill icon="linkedin">
              {contact.linkedin_url ? "LinkedIn profile" : "LinkedIn pending"}
            </ContactSignalPill>
            {contact.contact_fit_decision ? (
              <ContactSignalPill icon="fact_check">
                {contactFitLabel(contact.contact_fit_decision)}
              </ContactSignalPill>
            ) : null}
          </span>
        </span>
      </span>
      <span className="text-xs tabular-nums text-[var(--color-text-3)]">
        {freshWhen(contact.last_signal_at)}
      </span>
    </Link>
  );
}

function ContactSignalPill({
  icon,
  children,
}: {
  icon: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
      <Icon name={icon} size={12} />
      {children}
    </span>
  );
}

function contactFitLabel(decision: string): string {
  if (decision === "fit") return "Good fit";
  if (decision === "not_fit") return "Not a fit";
  return "Needs review";
}

function briefPriority(actions: BriefActionState, totalSent7d: number) {
  if (actions.pending_reviews > 0) {
    return {
      detail: `${actions.pending_reviews} drafted outreach ${
        actions.pending_reviews === 1 ? "message needs" : "messages need"
      } review before sending.`,
      href: "/dashboard/agent#opportunities",
      icon: "rate_review",
      label: "Review drafts",
    };
  }
  if (actions.unhealthy_channels > 0) {
    return {
      detail: `${actions.unhealthy_channels} connected ${
        actions.unhealthy_channels === 1 ? "account needs" : "accounts need"
      } attention before the agent can send reliably.`,
      href: "/dashboard/profile#channels",
      icon: "sync_problem",
      label: "Fix accounts",
    };
  }
  if (actions.qualified_signals_7d > 0 && totalSent7d === 0) {
    return {
      detail:
        "Qualified signals are ready, but no email or LinkedIn outreach has gone out this week.",
      href: "/dashboard/agent#opportunities",
      icon: "send",
      label: "Prepare outreach",
    };
  }
  return {
    detail:
      "The agent is running. Review fresh signal mix, sent outreach, and reply evidence before changing targeting.",
    href: "/dashboard/agent",
    icon: "arrow_forward",
    label: "Open Agent",
  };
}

function briefNextMoves(
  actions: BriefActionState,
  signalHealth: BriefSignalHealth,
  hotContactCount: number,
  learning: BriefLearningInsight,
  totalSent7d: number,
): BriefNextMove[] {
  const moves: BriefNextMove[] = [];

  if (actions.pending_reviews > 0) {
    moves.push({
      icon: "rate_review",
      title: "Review drafted outreach",
      detail: `${actions.pending_reviews} judged draft${
        actions.pending_reviews === 1 ? "" : "s"
      } ${actions.pending_reviews === 1 ? "needs" : "need"} a send decision before the agent can move them forward.`,
      href: "/dashboard/agent#opportunities",
      action: "Review",
      tone: "attention",
    });
  } else if (actions.qualified_signals_7d > 0 && totalSent7d === 0) {
    moves.push({
      icon: "send",
      title: "Turn signals into outreach",
      detail: `${actions.qualified_signals_7d} qualified signal${
        actions.qualified_signals_7d === 1 ? "" : "s"
      } are waiting for verified email or LinkedIn touches.`,
      href: "/dashboard/agent#opportunities",
      action: "Prepare",
      tone: "ready",
    });
  } else {
    moves.push({
      icon: "campaign",
      title: "Review sent outreach",
      detail: `${actions.emails_sent_7d} emails and ${actions.dms_sent_7d} LinkedIn DMs went out in the last week.`,
      href: "/dashboard/agent#outreach",
      action: "Open",
      tone: totalSent7d > 0 ? "ready" : "neutral",
    });
  }

  if (hotContactCount > 0) {
    moves.push({
      icon: "person_search",
      title: "Inspect hot contacts",
      detail: `${hotContactCount} fresh signal-backed contact${
        hotContactCount === 1 ? "" : "s"
      } are ready with email, LinkedIn, or fit context.`,
      href: "/dashboard/agent#verified-contacts",
      action: "Inspect",
      tone: "ready",
    });
  } else {
    moves.push({
      icon: "manage_search",
      title: "Resolve contact quality",
      detail: "Qualified signals become useful only after the agent finds verified emails or LinkedIn profiles.",
      href: "/dashboard/agent#opportunities",
      action: "Resolve",
      tone: "neutral",
    });
  }

  if (signalHealth.attention_source_name || signalHealth.quiet_sources > 0) {
    moves.push({
      icon: "monitor_heart",
      title: "Tune signal sources",
      detail:
        signalHealth.attention_source_name && signalHealth.attention_reason
          ? `${signalHealth.attention_source_name} needs attention: ${signalHealth.attention_reason}.`
          : `${signalHealth.quiet_sources} active source${
              signalHealth.quiet_sources === 1 ? " is" : "s are"
            } quiet this week.`,
      href: "/dashboard/agent#sources",
      action: "Tune",
      tone: "attention",
    });
  } else if (learning.strategy_summary || learning.skill_summary) {
    moves.push({
      icon: "auto_graph",
      title: "Apply weekly learning",
      detail:
        learning.strategy_summary ??
        learning.skill_summary ??
        "Replies and meetings are shaping the next outreach batch.",
      href: "/dashboard/agent#learning",
      action: "Apply",
      tone: "ready",
    });
  } else {
    moves.push({
      icon: "badge",
      title: "Keep Profile current",
      detail: "Website context, buyer fit, voice, email, LinkedIn, and contact rules control what the agent can do next.",
      href: "/dashboard/profile#profile",
      action: "Open",
      tone: "neutral",
    });
  }

  return moves;
}

function FunnelStep({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[8px] bg-[var(--color-ink-2)] px-3 py-2">
      <p className="text-[11px] text-[var(--color-text-3)]">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </p>
    </div>
  );
}

function BriefLearningPanel({
  learning,
}: {
  learning: BriefLearningInsight;
}) {
  const hasRecommendation = Boolean(
    learning.strategy_summary || learning.skill_summary,
  );
  if (!hasRecommendation) {
    return (
      <EmptyState
        title="No weekly learning yet"
        hint="Once replies and meetings are attributed, the agent will show what it learned about sources, channels, and message patterns."
        cta={{
          href: "/dashboard/agent#learning",
          label: "Open learning",
          icon: "auto_graph",
        }}
      />
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          Reply memory
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
          <FunnelStep label="Useful 30d" value={learning.useful_outcomes_30d} />
          <FunnelStep label="Patterns" value={learning.recommended_patterns} />
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
          Replies and meetings feed the agent's source, channel, and message
          choices before the next outreach batch.
        </p>
      </aside>
      <div className="grid gap-2">
        <BriefLearningCard
          icon="auto_graph"
          title="Strategy"
          summary={learning.strategy_summary}
          updatedAt={learning.strategy_updated_at}
          empty="No strategy recommendation yet."
        />
        <BriefLearningCard
          icon="science"
          title="Messages"
          summary={learning.skill_summary}
          updatedAt={learning.skill_updated_at}
          empty="No message recommendation yet."
        />
      </div>
    </div>
  );
}

function BriefLearningCard({
  icon,
  title,
  summary,
  updatedAt,
  empty,
}: {
  icon: string;
  title: string;
  summary: string | null;
  updatedAt: Date | null;
  empty: string;
}) {
  return (
    <article className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-8 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={icon} size={15} />
        </span>
        <p className="text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </p>
        {updatedAt ? (
          <span className="ml-auto text-xs text-[var(--color-text-3)]">
            Updated {freshWhen(updatedAt)}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
        {summary ?? empty}
      </p>
    </article>
  );
}

function OutcomeInsightRow({ insight }: { insight: BriefOutcomeInsight }) {
  const person = insight.counterparty_name ?? "Unknown contact";
  const company = insight.company_name ? ` at ${insight.company_name}` : "";
  const href = insight.conversation_id
    ? `/dashboard/conversations/${insight.conversation_id}${
        insight.attributed_message_id ? `#message-${insight.attributed_message_id}` : ""
      }`
    : "/dashboard/agent#outreach";
  return (
    <Link
      href={href}
      prefetch={false}
      className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-pos-bg)] text-[var(--color-pos)]">
          <Icon
            name={insight.kind === "meeting_booked" ? "event_available" : "mark_email_read"}
            size={17}
          />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
            {outcomeLabel(insight.kind)}
            <span className="font-normal text-[var(--color-text-3)]">
              {" "}
              from {person}
              {company}
            </span>
          </span>
          <span className="mt-1 block truncate text-sm text-[var(--color-text-2)]">
            {insight.signal_title ??
              insight.message_subject ??
              "Conversation outcome captured"}
          </span>
          {insight.reply_intent ? (
            <span className="mt-2 block text-xs text-[var(--color-text-3)]">
              Intent: {insight.reply_intent.replace(/_/g, " ")}
            </span>
          ) : null}
        </span>
      </span>
      <span className="text-xs tabular-nums text-[var(--color-text-3)]">
        {freshWhen(insight.occurred_at)}
      </span>
    </Link>
  );
}

function SignalKindRow({ signal }: { signal: SignalKindMetric }) {
  return (
    <Link
      href="/dashboard/agent#opportunities"
      className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 transition-colors hover:border-[var(--color-line-3)]"
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
          {signal.kind.replace(/_/g, " ")}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--color-text-3)]">
          {signal.count_24h} in 24h
        </span>
      </span>
      <span className="font-mono text-sm text-[var(--color-text-2)]">
        {signal.count_7d}
      </span>
    </Link>
  );
}

function outcomeLabel(kind: string): string {
  if (kind === "positive_reply") return "Positive reply";
  if (kind === "meeting_booked") return "Meeting booked";
  return kind.replace(/_/g, " ");
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringPayload(
  payload: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function arrayPayloadLength(
  payload: Record<string, unknown> | null,
  key: string,
): number {
  const value = payload?.[key];
  return Array.isArray(value) ? value.length : 0;
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
