import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspaceSession } from "@/lib/workspace";
import { EmptyState } from "@/components/dashboard/Shell";

export const dynamic = "force-dynamic";

interface RunningRow {
  id: string;
  kind: string;
  title: string;
  freshness_at: Date;
}

interface OutcomeRow {
  id: string;
  status: string;
  topic: string | null;
  last_activity_at: Date;
  counterparty_name: string | null;
  rep_name: string | null;
}

interface GtmPulse {
  prospects: PulseMetric;
  signals: PulseMetric;
  outreach: PulseMetric;
  campaigns: PulseMetric;
}

interface PulseMetric {
  count: number;
  last_activity_at: Date | null;
}

interface BriefActionState {
  pending_reviews: number;
  unhealthy_channels: number;
  bounced_24h: number;
  useful_outcomes_7d: number;
  meetings_7d: number;
}

async function loadRunning(workspaceId: string): Promise<RunningRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RunningRow>(
    `select id, kind::text as kind, title, freshness_at
       from signals
      where workspace_id = $1
        and status = 'matched'
      order by freshness_at desc
      limit 7`,
    [workspaceId],
  );
  return rows;
}

async function loadOutcomes(workspaceId: string): Promise<OutcomeRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<OutcomeRow>(
    `select c.id, c.status::text as status, c.topic, c.last_activity_at,
            p.full_name as counterparty_name,
            r.name as rep_name
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join reps r on r.id = c.rep_id
      where c.workspace_id = $1
      order by c.last_activity_at desc
      limit 7`,
    [workspaceId],
  );
  return rows;
}

async function loadGtmPulse(workspaceId: string): Promise<GtmPulse> {
  const pool = getPool();
  const { rows } = await pool.query<{
    prospects: string;
    prospects_last_activity_at: Date | null;
    signals: string;
    signals_last_activity_at: Date | null;
    outreach: string;
    outreach_last_activity_at: Date | null;
    campaigns: string;
    campaigns_last_activity_at: Date | null;
  }>(
    `select
       (select count(*)::text from graph_persons p
          where p.workspace_id = $1) as prospects,
       (select max(p.updated_at) from graph_persons p
          where p.workspace_id = $1) as prospects_last_activity_at,
       (select count(*)::text from signals s
          where s.workspace_id = $1
            and s.status in ('ingested','matched','in_play')
            and s.ingested_at >= now() - interval '24 hours') as signals,
       (select max(s.ingested_at) from signals s
          where s.workspace_id = $1
            and s.status in ('ingested','matched','in_play')) as signals_last_activity_at,
       (select count(*)::text from conversations c
          where c.workspace_id = $1
            and c.status in ('open','awaiting_them','awaiting_us')) as outreach,
       (select max(c.last_activity_at) from conversations c
          where c.workspace_id = $1
            and c.status in ('open','awaiting_them','awaiting_us')) as outreach_last_activity_at,
       (select count(*)::text from play_runs pr
          where pr.workspace_id = $1
            and pr.created_at >= now() - interval '24 hours') as campaigns,
       (select max(pr.created_at) from play_runs pr
          where pr.workspace_id = $1
            and pr.created_at >= now() - interval '24 hours') as campaigns_last_activity_at`,
    [workspaceId],
  );
  return {
    prospects: {
      count: Number(rows[0]?.prospects ?? 0),
      last_activity_at: rows[0]?.prospects_last_activity_at ?? null,
    },
    signals: {
      count: Number(rows[0]?.signals ?? 0),
      last_activity_at: rows[0]?.signals_last_activity_at ?? null,
    },
    outreach: {
      count: Number(rows[0]?.outreach ?? 0),
      last_activity_at: rows[0]?.outreach_last_activity_at ?? null,
    },
    campaigns: {
      count: Number(rows[0]?.campaigns ?? 0),
      last_activity_at: rows[0]?.campaigns_last_activity_at ?? null,
    },
  };
}

async function loadBriefActionState(workspaceId: string): Promise<BriefActionState> {
  const pool = getPool();
  const { rows } = await pool.query<{
    pending_reviews: string;
    unhealthy_channels: string;
    bounced_24h: string;
    useful_outcomes_7d: string;
    meetings_7d: string;
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
            and coalesce(o.recorded_at, o.occurred_at) >= now() - interval '7 days') as meetings_7d`,
    [workspaceId],
  );
  return {
    pending_reviews: Number(rows[0]?.pending_reviews ?? 0),
    unhealthy_channels: Number(rows[0]?.unhealthy_channels ?? 0),
    bounced_24h: Number(rows[0]?.bounced_24h ?? 0),
    useful_outcomes_7d: Number(rows[0]?.useful_outcomes_7d ?? 0),
    meetings_7d: Number(rows[0]?.meetings_7d ?? 0),
  };
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_TONE: Record<string, { label: string; tone: "pos" | "warn" | "neutral" }> = {
  awaiting_us: { label: "Needs reply", tone: "warn" },
  awaiting_them: { label: "Sent", tone: "neutral" },
  open: { label: "Open", tone: "neutral" },
  closed_positive: { label: "Won", tone: "pos" },
  closed_negative: { label: "Closed", tone: "neutral" },
  closed_no_response: { label: "Quiet", tone: "neutral" },
  booked: { label: "Booked", tone: "pos" },
  replied: { label: "Replied", tone: "pos" },
};

const EMPTY_ACTION_STATE: BriefActionState = {
  pending_reviews: 0,
  unhealthy_channels: 0,
  bounced_24h: 0,
  useful_outcomes_7d: 0,
  meetings_7d: 0,
};

const OPERATING_LOOP_META: Array<{
  key: keyof GtmPulse | "outcomes";
  step: string;
  name: string;
  href: string;
  icon: string;
  unit: (pulse: GtmPulse, actions: BriefActionState) => string;
  detail: (pulse: GtmPulse, actions: BriefActionState) => string;
}> = [
  {
    key: "prospects",
    step: "01",
    name: "Prospect graph",
    href: "/dashboard/prospecting",
    icon: "person",
    unit: (pulse) =>
      `${pulse.prospects.count} ${pulse.prospects.count === 1 ? "profile" : "profiles"}`,
    detail: (pulse) =>
      pulse.prospects.last_activity_at
        ? `Updated ${timeAgo(pulse.prospects.last_activity_at)}`
        : "Define the market once",
  },
  {
    key: "signals",
    step: "02",
    name: "Signals",
    href: "/dashboard/signals",
    icon: "sensors",
    unit: (pulse) =>
      `${pulse.signals.count} ${pulse.signals.count === 1 ? "fresh Signal" : "fresh Signals"}`,
    detail: (pulse) =>
      pulse.signals.last_activity_at
        ? `Last matched ${timeAgo(pulse.signals.last_activity_at)}`
        : "Waiting for timing evidence",
  },
  {
    key: "campaigns",
    step: "03",
    name: "Plays",
    href: "/dashboard/campaigns",
    icon: "science",
    unit: (pulse) =>
      `${pulse.campaigns.count} ${pulse.campaigns.count === 1 ? "run" : "runs"} today`,
    detail: (pulse) =>
      pulse.campaigns.last_activity_at
        ? `Started ${timeAgo(pulse.campaigns.last_activity_at)}`
        : "Small bets before scale",
  },
  {
    key: "outreach",
    step: "04",
    name: "Conversations",
    href: "/dashboard/conversations",
    icon: "forum",
    unit: (pulse, actions) =>
      `${pulse.outreach.count} moving · ${actions.pending_reviews} review`,
    detail: (pulse) =>
      pulse.outreach.last_activity_at
        ? `Last activity ${timeAgo(pulse.outreach.last_activity_at)}`
        : "Replies collect here",
  },
  {
    key: "outcomes",
    step: "05",
    name: "Outcomes",
    href: "/dashboard/campaigns",
    icon: "task_alt",
    unit: (_pulse, actions) => `${actions.useful_outcomes_7d} useful this week`,
    detail: (_pulse, actions) =>
      actions.meetings_7d > 0
        ? `${actions.meetings_7d} ${actions.meetings_7d === 1 ? "meeting" : "meetings"} booked`
        : "Learning waits for proof",
  },
];

export default async function BriefPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return (
      <BriefView
        running={[]}
        outcomes={[]}
        pulse={{
          prospects: { count: 0, last_activity_at: null },
          signals: { count: 0, last_activity_at: null },
          outreach: { count: 0, last_activity_at: null },
          campaigns: { count: 0, last_activity_at: null },
        }}
        actions={EMPTY_ACTION_STATE}
      />
    );
  }
  const [running, outcomes, pulse, actions] = await Promise.all([
    loadRunning(session.workspace.id),
    loadOutcomes(session.workspace.id),
    loadGtmPulse(session.workspace.id),
    loadBriefActionState(session.workspace.id),
  ]);
  return (
    <BriefView
      running={running}
      outcomes={outcomes}
      pulse={pulse}
      actions={actions}
    />
  );
}

function BriefView({
  running,
  outcomes,
  pulse,
  actions,
}: {
  running: RunningRow[];
  outcomes: OutcomeRow[];
  pulse: GtmPulse;
  actions: BriefActionState;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const totalPulse =
    pulse.prospects.count + pulse.signals.count + pulse.outreach.count + pulse.campaigns.count;
  const lastMovement = latestPulseDate(pulse);
  const priorityActions = buildPriorityActions(pulse, actions);

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-[12px] border border-[color:var(--color-line-1)] bg-[var(--color-ink-0)] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-7 lg:p-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          {today}
        </p>
        <h1
          className="display-serif mt-5 max-w-[980px] break-words text-[2.25rem] text-[var(--color-text-1)] sm:text-[clamp(2.5rem,5.4vw,4.5rem)]"
          style={{ fontWeight: 500, letterSpacing: 0, lineHeight: 1.02 }}
        >
          <span className="block">Your GTM runs from</span>
          {" "}
          <em>Signal to Outcome.</em>
        </h1>
        <p className="mt-5 max-w-[72ch] text-[15px] leading-[1.7] text-[var(--color-text-2)]">
          {totalPulse === 0
            ? "Nothing to surface yet. Define the prospecting profile once, then signal-led outreach will appear here."
            : `Prospects: ${pulse.prospects.count}. Fresh Signals: ${pulse.signals.count}. Active Conversations: ${pulse.outreach.count}. Play runs today: ${pulse.campaigns.count}. Useful Outcomes this week: ${actions.useful_outcomes_7d}.${lastMovement ? ` Last movement ${timeAgo(lastMovement)}.` : ""}`}
        </p>
        <div className="mt-7 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <BriefMetric label="Prospects" value={pulse.prospects.count} />
          <BriefMetric label="Signals" value={pulse.signals.count} />
          <BriefMetric label="Conversations" value={pulse.outreach.count} />
          <BriefMetric label="Outcomes" value={actions.useful_outcomes_7d} />
        </div>
      </section>

      {/* Operating loop */}
      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-12">
        <OperatingLoop pulse={pulse} actions={actions} />
        <PriorityActions actions={priorityActions} />
      </section>

      {/* Two feeds */}
      <section className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <Feed
          eyebrow="Signals"
          title="Qualified signals"
          empty={
            <EmptyState
              title="No signals yet."
              hint="Bombsell will surface good-fit opportunities after prospecting is tuned."
              cta={{ href: "/dashboard/prospecting", label: "Tune prospecting", icon: "person" }}
            />
          }
        >
          {running.map((r) => (
            <FeedRow
              key={r.id}
              icon="sensors"
              title={r.title}
              meta={`Qualified · ${timeAgo(new Date(r.freshness_at))}`}
            />
          ))}
        </Feed>

        <Feed
          eyebrow="Outcomes"
          title="Replies and outcomes"
          empty={
            <EmptyState
              title="No outcomes yet."
              hint="Replies, bookings and won conversations will land here as they happen."
              cta={{ href: "/dashboard/conversations", label: "Open outreach", icon: "forum" }}
            />
          }
        >
          {outcomes.map((c) => {
            const tone = STATUS_TONE[c.status] ?? { label: c.status, tone: "neutral" as const };
            return (
              <FeedRow
                key={c.id}
                icon="mark_email_read"
                href={`/dashboard/conversations/${c.id}`}
                title={c.counterparty_name ?? c.topic ?? "Conversation"}
                meta={`${c.rep_name ?? "Rep"} · ${timeAgo(new Date(c.last_activity_at))}`}
                pill={tone}
              />
            );
          })}
        </Feed>
      </section>
    </div>
  );
}

function latestPulseDate(pulse: GtmPulse): Date | null {
  const times = Object.values(pulse)
    .map((metric) => metric.last_activity_at?.getTime() ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

function BriefMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-3">
      <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-3)]">
        {label}
      </span>
      <strong className="mt-2 block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
    </div>
  );
}

function Feed({
  eyebrow,
  title,
  empty,
  children,
}: {
  eyebrow: string;
  title: string;
  empty: ReactNode;
  children: ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="rounded-[10px] border border-[var(--color-line-2)] bg-[var(--color-ink-0)] p-4">
      <div className="mb-4 flex items-baseline justify-between border-b border-[var(--color-line-1)] pb-3">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          {eyebrow}
        </p>
        <h2
          className="text-[15px] font-medium text-[var(--color-text-2)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
      </div>
      {hasChildren ? <ul className="divide-y divide-[color:var(--color-line-1)]">{children}</ul> : empty}
    </div>
  );
}

function FeedRow({
  icon,
  title,
  meta,
  pill,
  href,
}: {
  icon: string;
  title: string;
  meta: string;
  pill?: { label: string; tone: "pos" | "warn" | "neutral" };
  href?: string;
}) {
  const inner = (
    <div className="flex items-start gap-3 px-1 py-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
        <Icon name={icon} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-medium text-[var(--color-text-1)]">
          {title}
        </div>
        <div className="mt-0.5 truncate text-[12.5px] text-[var(--color-text-3)]">
          {meta}
        </div>
      </div>
      {pill ? (
        <span
          className={
            "shrink-0 rounded-[8px] px-2 py-0.5 text-[10.5px] font-medium " +
            (pill.tone === "pos"
              ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
              : pill.tone === "warn"
                ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
          }
        >
          {pill.label}
        </span>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <li>
        <Link
          href={href}
          className="block rounded-[8px] transition-colors hover:bg-[var(--color-ink-2)]/70"
        >
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}

function OperatingLoop({
  pulse,
  actions,
}: {
  pulse: GtmPulse;
  actions: BriefActionState;
}) {
  return (
    <div>
      <div className="mb-5 flex items-baseline justify-between">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-accent)]">
          Operating loop
        </p>
        <h2
          className="text-[15px] font-medium text-[var(--color-text-2)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Prospecting to learning
        </h2>
      </div>
      <div className="operating-loop">
        {OPERATING_LOOP_META.map((item) => (
          <Link key={item.name} href={item.href} className="operating-loop-step">
            <span className="operating-loop-index">{item.step}</span>
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
              <Icon name={item.icon} size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-semibold text-[var(--color-text-1)]">
                {item.name}
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-[var(--color-text-3)]">
                {item.unit(pulse, actions)}
              </span>
            </span>
            <span className="ml-auto hidden text-right text-[12px] text-[var(--color-text-3)] md:block">
              {item.detail(pulse, actions)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function PriorityActions({ actions }: { actions: PriorityAction[] }) {
  return (
    <aside className="section-note h-fit">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">Next useful moves</p>
      <div className="mt-4 grid gap-2">
        {actions.map((action) => (
          <Link key={action.title} href={action.href} className="priority-action">
            <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
              <Icon name={action.icon} size={16} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--color-text-1)]">
                {action.title}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-3)]">
                {action.detail}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </aside>
  );
}

interface PriorityAction {
  title: string;
  detail: string;
  href: string;
  icon: string;
}

function buildPriorityActions(
  pulse: GtmPulse,
  actions: BriefActionState,
): PriorityAction[] {
  const items: PriorityAction[] = [];
  if (pulse.prospects.count === 0) {
    items.push({
      title: "Build the prospect graph",
      detail: "Profile, ICP, voice, and channel pace are the first inputs.",
      href: "/dashboard/prospecting",
      icon: "person",
    });
  }
  if (actions.unhealthy_channels > 0 || actions.bounced_24h > 0) {
    items.push({
      title: "Restore channel health",
      detail: `${actions.unhealthy_channels} channel ${
        actions.unhealthy_channels === 1 ? "account needs" : "accounts need"
      } attention. ${actions.bounced_24h} ${
        actions.bounced_24h === 1 ? "bounce" : "bounces"
      } today.`,
      href: "/dashboard/deliverability",
      icon: "health_and_safety",
    });
  }
  if (actions.pending_reviews > 0) {
    items.push({
      title: "Review judged drafts",
      detail: `${actions.pending_reviews} ${
        actions.pending_reviews === 1 ? "draft is" : "drafts are"
      } waiting for a human decision.`,
      href: "/dashboard/review",
      icon: "rate_review",
    });
  }
  if (pulse.signals.count > 0) {
    items.push({
      title: "Prepare Signal-led outreach",
      detail: `${pulse.signals.count} fresh ${
        pulse.signals.count === 1 ? "Signal has" : "Signals have"
      } timing evidence.`,
      href: "/dashboard/signals",
      icon: "sensors",
    });
  }
  if (pulse.outreach.count > 0) {
    items.push({
      title: "Move active Conversations",
      detail: `${pulse.outreach.count} ${
        pulse.outreach.count === 1 ? "thread is" : "threads are"
      } still open across email and LinkedIn.`,
      href: "/dashboard/conversations",
      icon: "forum",
    });
  }
  if (actions.useful_outcomes_7d > 0) {
    items.push({
      title: "Scale what produced Outcomes",
      detail: `${actions.useful_outcomes_7d} useful ${
        actions.useful_outcomes_7d === 1 ? "Outcome" : "Outcomes"
      } can sharpen the next Play.`,
      href: "/dashboard/campaigns",
      icon: "task_alt",
    });
  }
  if (items.length === 0) {
    items.push({
      title: "Refresh Signals",
      detail: "No urgent work is waiting. Check the latest market movement.",
      href: "/dashboard/signals",
      icon: "refresh",
    });
  }
  return items.slice(0, 4);
}
