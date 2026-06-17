import type { Metadata } from "next";
import Link from "next/link";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { EmptyState } from "@/components/dashboard/Shell";
import { SurfaceSection } from "@/components/dashboard/SurfaceHero";

export const metadata: Metadata = {
  title: "Dashboard | Bombsell",
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

export default async function BriefPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return (
      <BriefView
        actions={EMPTY_ACTION_STATE}
        signalKinds={[]}
        workspaceName="there"
      />
    );
  }
  const [actions, signalKinds] = await Promise.all([
    loadBriefActionState(session.workspace.id),
    loadSignalKindMetrics(session.workspace.id),
  ]);
  return (
    <BriefView
      actions={actions}
      signalKinds={signalKinds}
      workspaceName={session.workspace.name}
    />
  );
}

function BriefView({
  actions,
  signalKinds,
  workspaceName,
}: {
  actions: BriefActionState;
  signalKinds: SignalKindMetric[];
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

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DashboardMetric
          icon="sensors"
          label="Qualified signals"
          day={actions.qualified_signals_24h}
          week={actions.qualified_signals_7d}
        />
        <DashboardMetric
          icon="mail"
          label="Emails sent"
          day={actions.emails_sent_24h}
          week={actions.emails_sent_7d}
        />
        <DashboardMetric
          icon="forum"
          label="LinkedIn DMs"
          day={actions.dms_sent_24h}
          week={actions.dms_sent_7d}
        />
        <DashboardMetric
          icon="event_available"
          label="Replies / meetings"
          day={actions.replies_24h + actions.meetings_24h}
          week={actions.replies_7d + actions.meetings_7d}
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <SurfaceSection title="Signal mix">
          {signalKinds.length === 0 ? (
            <EmptyState
              title="No qualified signals yet"
              hint="Complete the profile and connected accounts so the agent can qualify real timing signals."
              cta={{ href: "/dashboard/settings#profile", label: "Open profile", icon: "person" }}
            />
          ) : (
            <div className="grid gap-2">
              {signalKinds.map((signal) => (
                <SignalKindRow key={signal.kind} signal={signal} />
              ))}
            </div>
          )}
        </SurfaceSection>

        <aside className="section-note h-fit">
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Agent insight
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-3)]">
            {totalSent7d === 0
              ? "No outbound volume in the last week. Connect Outlook or LinkedIn, then let qualified signals become verified contacts and judged drafts."
              : `${totalSent7d} emails or DMs went out in the last week. ${actions.replies_7d} got useful replies, ${actions.meetings_7d} became meetings, and the current reply rate is ${replyRate}%.`}
          </p>
          <Link href="/dashboard/reps#outreach" className="btn-solid-sm mt-4 w-fit">
            <Icon name="arrow_forward" size={14} />
            Open Agent
          </Link>
        </aside>
      </section>
    </div>
  );
}

function DashboardMetric({
  icon,
  label,
  day,
  week,
}: {
  icon: string;
  label: string;
  day: number;
  week: number;
}) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={icon} size={17} />
        </span>
        <span className="text-[11px] text-[var(--color-text-3)]">24h / 7d</span>
      </div>
      <p className="mt-4 text-sm font-semibold text-[var(--color-text-1)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
        {day} <span className="text-sm font-medium text-[var(--color-text-3)]">/ {week}</span>
      </p>
    </div>
  );
}

function SignalKindRow({ signal }: { signal: SignalKindMetric }) {
  return (
    <Link
      href="/dashboard/reps#verified-contacts"
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
