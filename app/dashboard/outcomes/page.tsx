import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface OutcomeRow {
  id: string;
  kind: string;
  score: string;
  occurred_at: Date;
  recorded_at: Date;
  conversation_id: string | null;
  counterparty_name: string | null;
  company_name: string | null;
  rep_name: string | null;
  signal_title: string | null;
}

interface OutcomeStats {
  useful_7d: number;
  meetings_7d: number;
  negative_7d: number;
}

async function loadOutcomes(workspaceId: string): Promise<OutcomeRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<OutcomeRow>(
    `select o.id,
            o.kind::text as kind,
            o.score::text as score,
            o.occurred_at,
            o.recorded_at,
            o.conversation_id,
            p.full_name as counterparty_name,
            co.name as company_name,
            r.name as rep_name,
            s.title as signal_title
       from outcomes o
       left join conversations c on c.id = o.conversation_id
       left join graph_persons p on p.id = coalesce(o.subject_person_id, c.counterparty_person_id)
       left join graph_companies co on co.id = coalesce(o.subject_company_id, c.counterparty_company_id)
       left join reps r on r.id = coalesce(o.attributed_rep_id, c.rep_id)
       left join signals s on s.id = coalesce(o.attributed_signal_id, c.origin_signal_id)
      where o.workspace_id = $1
      order by o.occurred_at desc
      limit 100`,
    [workspaceId],
  );
  return rows;
}

async function loadOutcomeStats(workspaceId: string): Promise<OutcomeStats> {
  const pool = getPool();
  const { rows } = await pool.query<{
    useful_7d: string;
    meetings_7d: string;
    negative_7d: string;
  }>(
    `select
       (select count(*)::text from outcomes
          where workspace_id = $1
            and kind in ('positive_reply','meeting_booked','opportunity_created','deal_won')
            and coalesce(recorded_at, occurred_at) >= now() - interval '7 days') as useful_7d,
       (select count(*)::text from outcomes
          where workspace_id = $1
            and kind = 'meeting_booked'
            and coalesce(recorded_at, occurred_at) >= now() - interval '7 days') as meetings_7d,
       (select count(*)::text from outcomes
          where workspace_id = $1
            and kind in ('bounce','unsubscribe','do_not_contact','deal_lost')
            and coalesce(recorded_at, occurred_at) >= now() - interval '7 days') as negative_7d`,
    [workspaceId],
  );
  return {
    useful_7d: Number(rows[0]?.useful_7d ?? 0),
    meetings_7d: Number(rows[0]?.meetings_7d ?? 0),
    negative_7d: Number(rows[0]?.negative_7d ?? 0),
  };
}

export default async function OutcomesPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <SurfaceHero
        kicker="Dashboard"
        title="No workspace selected."
        description="Create or select a workspace before Bombsell can attribute replies, meetings, and learning."
      />
    );
  }

  const [outcomes, stats] = await Promise.all([
    loadOutcomes(workspace.id),
    loadOutcomeStats(workspace.id),
  ]);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Dashboard"
        title={<>Reply and meeting <em>insights</em>.</>}
        description="Replies, meetings, opportunities, bounces, and opt-outs are the facts that protect outreach and help the agent learn."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Useful 7d" value={stats.useful_7d} />
            <HeroStat label="Meetings 7d" value={stats.meetings_7d} />
            <HeroStat label="Negative 7d" value={stats.negative_7d} />
          </div>
        }
      />

      <SurfaceSection title="Reply insight ledger">
        {outcomes.length === 0 ? (
          <EmptyState
            title="No reply insights recorded yet."
            hint="Once outreach produces replies, meetings, or opt-outs, this view will show what happened and which signal earned it."
            cta={{
              href: "/dashboard/conversations",
              label: "Open outreach",
              icon: "forum",
            }}
          />
        ) : (
          <div className="grid gap-2">
            {outcomes.map((outcome) => (
              <OutcomeCard key={outcome.id} outcome={outcome} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: OutcomeRow }) {
  const content = (
    <article className="grid gap-4 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
          <Icon name={outcomeIcon(outcome.kind)} size={17} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">
              {outcomeLabel(outcome.kind)}
            </p>
            <span className={outcomeTone(outcome.kind)}>
              Score {Number(outcome.score).toFixed(2)}
            </span>
          </div>
          <p className="mt-1 truncate text-sm text-[var(--color-text-2)]">
            {outcome.counterparty_name ?? "Unknown person"}
            {outcome.company_name ? ` at ${outcome.company_name}` : ""}
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-3)]">
            {outcome.rep_name ? "Agent" : "No agent"} / {outcome.signal_title ?? "No signal attribution"} / {freshWhen(outcome.occurred_at)}
          </p>
        </div>
      </div>
      <span className="text-xs font-medium text-[var(--color-accent)]">
        {outcome.conversation_id ? "Open outreach" : "Unattributed"}
      </span>
    </article>
  );

  if (!outcome.conversation_id) return content;
  return (
    <Link href={`/dashboard/conversations/${outcome.conversation_id}`} prefetch={false}>
      {content}
    </Link>
  );
}

function outcomeLabel(kind: string): string {
  if (kind === "positive_reply") return "Positive reply";
  if (kind === "meeting_booked") return "Meeting booked";
  if (kind === "opportunity_created") return "Opportunity created";
  if (kind === "deal_won") return "Deal won";
  if (kind === "deal_lost") return "Deal lost";
  if (kind === "unsubscribe") return "Unsubscribe";
  if (kind === "do_not_contact") return "Do not contact";
  if (kind === "bounce") return "Bounce";
  return kind.replace(/_/g, " ");
}

function outcomeIcon(kind: string): string {
  if (kind === "meeting_booked") return "event_available";
  if (kind === "positive_reply" || kind === "opportunity_created" || kind === "deal_won") {
    return "task_alt";
  }
  if (kind === "bounce" || kind === "unsubscribe" || kind === "do_not_contact" || kind === "deal_lost") {
    return "report";
  }
  return "insights";
}

function outcomeTone(kind: string): string {
  const base = "rounded-[8px] px-2 py-1 text-[11px] font-medium ";
  if (kind === "bounce" || kind === "unsubscribe" || kind === "do_not_contact" || kind === "deal_lost") {
    return base + "bg-[var(--color-neg-bg)] text-[var(--color-neg)]";
  }
  return base + "bg-[var(--color-pos-bg)] text-[var(--color-pos)]";
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
