import Link from "next/link";
import type { ReactNode } from "react";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getProductReviewPulse } from "@/core/product/app.ts";
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

interface RepPulse {
  sampark_active: PulseMetric;
  vaani_angles: PulseMetric;
  prayog_runs: PulseMetric;
  bodh_gaps: PulseMetric;
}

interface PulseMetric {
  count: number;
  last_activity_at: Date | null;
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

async function loadRepPulse(
  workspaceId: string,
  contentAngles: number,
  contentLast: Date | null,
  aeoGaps: number,
  aeoLast: Date | null,
): Promise<RepPulse> {
  const pool = getPool();
  const { rows } = await pool.query<{
    sampark_active: string;
    sampark_last_activity_at: Date | null;
    prayog_runs: string;
    prayog_last_activity_at: Date | null;
  }>(
    `select
       (select count(*)::text from conversations c
          join reps r on r.id = c.rep_id
          where c.workspace_id = $1
            and lower(r.name) = 'sampark'
            and c.status in ('open','awaiting_them','awaiting_us')) as sampark_active,
       (select max(c.last_activity_at) from conversations c
          join reps r on r.id = c.rep_id
          where c.workspace_id = $1
            and lower(r.name) = 'sampark'
            and c.status in ('open','awaiting_them','awaiting_us')) as sampark_last_activity_at,
       (select count(*)::text from play_runs pr
          join plays p on p.id = pr.play_id
          left join reps run_rep on run_rep.id = pr.rep_id
          left join reps default_rep on default_rep.id = p.default_rep_id
          where pr.workspace_id = $1
            and lower(coalesce(run_rep.name, default_rep.name, '')) = 'prayog'
            and pr.created_at >= now() - interval '24 hours') as prayog_runs,
       (select max(pr.created_at) from play_runs pr
          join plays p on p.id = pr.play_id
          left join reps run_rep on run_rep.id = pr.rep_id
          left join reps default_rep on default_rep.id = p.default_rep_id
          where pr.workspace_id = $1
            and lower(coalesce(run_rep.name, default_rep.name, '')) = 'prayog'
            and pr.created_at >= now() - interval '24 hours') as prayog_last_activity_at`,
    [workspaceId],
  );
  return {
    sampark_active: {
      count: Number(rows[0]?.sampark_active ?? 0),
      last_activity_at: rows[0]?.sampark_last_activity_at ?? null,
    },
    vaani_angles: { count: contentAngles, last_activity_at: contentLast },
    prayog_runs: {
      count: Number(rows[0]?.prayog_runs ?? 0),
      last_activity_at: rows[0]?.prayog_last_activity_at ?? null,
    },
    bodh_gaps: { count: aeoGaps, last_activity_at: aeoLast },
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

const REP_TILES: Array<{
  key: keyof RepPulse;
  name: string;
  role: string;
  href: string;
  icon: string;
  unit: (n: number) => string;
}> = [
  {
    key: "sampark_active",
    name: "Sampark",
    role: "Outreach SDR",
    href: "/dashboard/conversations",
    icon: "forum",
    unit: (n) => `${n} ${n === 1 ? "conversation" : "conversations"} moving`,
  },
  {
    key: "vaani_angles",
    name: "Vaani",
    role: "Content",
    href: "/dashboard/content",
    icon: "edit_note",
    unit: (n) => `${n} ${n === 1 ? "angle" : "angles"} to review`,
  },
  {
    key: "prayog_runs",
    name: "Prayog",
    role: "Campaigns",
    href: "/dashboard/ingestion",
    icon: "science",
    unit: (n) => `${n} ${n === 1 ? "campaign idea" : "campaign ideas"} today`,
  },
  {
    key: "bodh_gaps",
    name: "Bodh",
    role: "AEO",
    href: "/dashboard/aeo",
    icon: "neurology",
    unit: (n) => `${n} ${n === 1 ? "suggestion" : "suggestions"} open`,
  },
];

export default async function BriefPage() {
  const session = await getActiveWorkspaceSession();
  if (!session) {
    return (
      <BriefView
        workspaceName={null}
        running={[]}
        outcomes={[]}
        pulse={{
          sampark_active: { count: 0, last_activity_at: null },
          vaani_angles: { count: 0, last_activity_at: null },
          prayog_runs: { count: 0, last_activity_at: null },
          bodh_gaps: { count: 0, last_activity_at: null },
        }}
      />
    );
  }
  const pool = getPool();
  const [reviewPulse, running, outcomes] = await Promise.all([
    getProductReviewPulse(pool, {
      workspace_id: session.workspace.id,
      user_id: session.user_id,
    }),
    loadRunning(session.workspace.id),
    loadOutcomes(session.workspace.id),
  ]);
  const pulse = await loadRepPulse(
    session.workspace.id,
    reviewPulse.content.open,
    reviewPulse.content.last_activity_at,
    reviewPulse.aeo.open,
    reviewPulse.aeo.last_activity_at,
  );
  return (
    <BriefView
      workspaceName={session.workspace.name}
      running={running}
      outcomes={outcomes}
      pulse={pulse}
    />
  );
}

function BriefView({
  workspaceName,
  running,
  outcomes,
  pulse,
}: {
  workspaceName: string | null;
  running: RunningRow[];
  outcomes: OutcomeRow[];
  pulse: RepPulse;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const totalPulse =
    pulse.sampark_active.count + pulse.vaani_angles.count + pulse.prayog_runs.count + pulse.bodh_gaps.count;
  const heroVerb = heroWorkVerb(today);
  const lastMovement = latestPulseDate(pulse);

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="border-b border-[color:var(--color-line-2)] pb-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-3)]">
          {today}
        </p>
        <h1
          className="display-serif mt-5 text-[clamp(2.5rem,5.4vw,4.5rem)] text-[var(--color-text-1)]"
          style={{ fontWeight: 500, letterSpacing: "-0.035em", lineHeight: 1.0 }}
        >
          {workspaceName ? (
            <>
              <span className="block">{workspaceName} is</span>
              <em>{heroVerb}.</em>
            </>
          ) : (
            <>
              <span className="block">Set the profile.</span>
              <em>Then walk away.</em>
            </>
          )}
        </h1>
        <p className="mt-5 max-w-[64ch] text-[15px] leading-[1.7] text-[var(--color-text-2)]">
          {totalPulse === 0
            ? "Nothing to surface yet. Finish the profile once, then useful work will appear here."
            : `Sampark conversations: ${pulse.sampark_active.count}. Content ideas: ${pulse.vaani_angles.count}. Campaign ideas: ${pulse.prayog_runs.count}. AEO suggestions: ${pulse.bodh_gaps.count}.${lastMovement ? ` Last movement ${timeAgo(lastMovement)}.` : ""}`}
        </p>
      </section>

      {/* Rep tiles */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {REP_TILES.map((tile) => {
          const metric = pulse[tile.key];
          return (
            <Link
              key={tile.name}
              href={tile.href}
              className="group rounded-lg border border-[color:var(--color-line-2)] bg-[var(--color-ink-0)] p-5 transition-colors hover:bg-[var(--color-ink-2)]/40"
            >
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
                  <Icon name={tile.icon} size={15} />
                </span>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                  {tile.role}
                </p>
              </div>
              <p
                className="mt-4 text-[22px] font-semibold tracking-[-0.01em] text-[var(--color-text-1)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {tile.name}
              </p>
              <p className="mt-1 text-[13px] text-[var(--color-text-2)]">
                {tile.unit(metric.count)}
              </p>
              {metric.last_activity_at ? (
                <p className="mt-3 text-[12px] text-[var(--color-text-3)]">
                  Fresh {timeAgo(new Date(metric.last_activity_at))}
                </p>
              ) : null}
            </Link>
          );
        })}
      </section>

      {/* Two feeds */}
      <section className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <Feed
          eyebrow="Signals"
          title="Qualified signals"
          empty={
            <EmptyState
              title="No signals yet."
              hint="Bombsell will surface good-fit opportunities after the profile is tuned."
              cta={{ href: "/dashboard/setup", label: "Tune profile", icon: "tune" }}
            />
          }
        >
          {running.map((r) => (
            <FeedRow
              key={r.id}
              icon="target"
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

function latestPulseDate(pulse: RepPulse): Date | null {
  const times = Object.values(pulse)
    .map((metric) => metric.last_activity_at?.getTime() ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

function heroWorkVerb(today: string): string {
  const verbs = ["working quietly", "moving the day forward", "keeping the canvas warm", "finding the next useful move"];
  const seed = today.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return verbs[seed % verbs.length];
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
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.2em] text-[var(--color-text-3)]">
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
    <div className="flex items-start gap-3 py-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
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
            "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium " +
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
        <Link href={href} className="block transition-colors hover:bg-[var(--color-ink-2)]/40">
          {inner}
        </Link>
      </li>
    );
  }
  return <li>{inner}</li>;
}
