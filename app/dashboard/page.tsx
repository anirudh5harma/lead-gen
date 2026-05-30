import Link from "next/link";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
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

async function loadRunning(workspaceId: string): Promise<RunningRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RunningRow>(
    `select id, kind::text as kind, title, freshness_at
       from signals
      where workspace_id = $1
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
  awaiting_us: { label: "Needs you", tone: "warn" },
  awaiting_them: { label: "Awaiting them", tone: "neutral" },
  open: { label: "Open", tone: "neutral" },
  closed_won: { label: "Won", tone: "pos" },
  closed_lost: { label: "Closed", tone: "neutral" },
  booked: { label: "Booked", tone: "pos" },
  replied: { label: "Replied", tone: "pos" },
};

const SIGNAL_ICONS: Record<string, string> = {
  hiring: "work",
  funding: "trending_up",
  intent: "campaign",
  social: "alternate_email",
  news: "newspaper",
};

export default async function BriefPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <BriefView
        workspaceName={null}
        running={[]}
        outcomes={[]}
      />
    );
  }
  const [running, outcomes] = await Promise.all([
    loadRunning(workspace.id),
    loadOutcomes(workspace.id),
  ]);
  return (
    <BriefView
      workspaceName={workspace.name}
      running={running}
      outcomes={outcomes}
    />
  );
}

function BriefView({
  workspaceName,
  running,
  outcomes,
}: {
  workspaceName: string | null;
  running: RunningRow[];
  outcomes: OutcomeRow[];
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

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
              <em>working quietly.</em>
            </>
          ) : (
            <>
              <span className="block">Set the profile.</span>
              <em>Then walk away.</em>
            </>
          )}
        </h1>
        <p className="mt-5 max-w-[64ch] text-[15px] leading-[1.7] text-[var(--color-text-2)]">
          {running.length + outcomes.length === 0
            ? "Nothing to surface yet. Once profile, channels and plays are in place, the work will appear here."
            : `${running.length} ${running.length === 1 ? "thing" : "things"} running, ${outcomes.length} ${outcomes.length === 1 ? "trajectory" : "trajectories"} moving.`}
        </p>
      </section>

      {/* Two feeds */}
      <section className="grid gap-12 lg:grid-cols-2 lg:gap-16">
        <Feed
          eyebrow="Running"
          title="What the system is watching"
          empty={
            <EmptyState
              title="No signals yet."
              hint="Bombsell will surface what it's tracking once sources are connected."
            />
          }
        >
          {running.map((r) => (
            <FeedRow
              key={r.id}
              icon={SIGNAL_ICONS[r.kind] ?? "sensors"}
              title={r.title}
              meta={`${r.kind} · ${timeAgo(new Date(r.freshness_at))}`}
            />
          ))}
        </Feed>

        <Feed
          eyebrow="Outcomes"
          title="Trajectories moving"
          empty={
            <EmptyState
              title="No outcomes yet."
              hint="Replies, bookings and won conversations will land here as they happen."
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

function Feed({
  eyebrow,
  title,
  empty,
  children,
}: {
  eyebrow: string;
  title: string;
  empty: React.ReactNode;
  children: React.ReactNode;
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
