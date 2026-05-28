import Link from "next/link";
import {
  EmptyState,
  MetricCard,
  SectionHeader,
} from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface RecentSignalRow {
  id: string;
  kind: string;
  title: string;
  freshness_at: Date;
  match_score: string | null;
}

interface ConversationRow {
  id: string;
  status: string;
  topic: string | null;
  last_activity_at: Date;
  counterparty_name: string | null;
  rep_name: string | null;
  inbound_count: string;
  outbound_count: string;
}

interface TodayCounts {
  signals_24h: number;
  drafts_24h: number;
  sent_24h: number;
  replies_24h: number;
  outcomes_24h: number;
}

async function loadTodayCounts(workspaceId: string): Promise<TodayCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{
    signals_24h: string;
    drafts_24h: string;
    sent_24h: string;
    replies_24h: string;
    outcomes_24h: string;
  }>(
    `select
       (select count(*)::text from signals where workspace_id = $1 and ingested_at >= now() - interval '24 hours') as signals_24h,
       (select count(*)::text from messages where workspace_id = $1 and direction = 'outbound' and status = 'draft' and created_at >= now() - interval '24 hours') as drafts_24h,
       (select count(*)::text from messages where workspace_id = $1 and direction = 'outbound' and status in ('sent','delivered','replied') and sent_at >= now() - interval '24 hours') as sent_24h,
       (select count(*)::text from messages where workspace_id = $1 and direction = 'inbound' and created_at >= now() - interval '24 hours') as replies_24h,
       (select count(*)::text from outcomes where workspace_id = $1 and recorded_at >= now() - interval '24 hours') as outcomes_24h`,
    [workspaceId],
  );
  return {
    signals_24h: Number(rows[0].signals_24h),
    drafts_24h: Number(rows[0].drafts_24h),
    sent_24h: Number(rows[0].sent_24h),
    replies_24h: Number(rows[0].replies_24h),
    outcomes_24h: Number(rows[0].outcomes_24h),
  };
}

async function loadRecentSignals(workspaceId: string): Promise<RecentSignalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RecentSignalRow>(
    `select id, kind::text as kind, title, freshness_at, match_score::text as match_score
       from signals
      where workspace_id = $1
      order by freshness_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

async function loadActiveConversations(workspaceId: string): Promise<ConversationRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ConversationRow>(
    `select c.id, c.status::text as status, c.topic, c.last_activity_at,
            p.full_name as counterparty_name,
            r.name as rep_name,
            (select count(*)::text from messages m
              where m.conversation_id = c.id and m.direction = 'inbound') as inbound_count,
            (select count(*)::text from messages m
              where m.conversation_id = c.id and m.direction = 'outbound') as outbound_count
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join reps r on r.id = c.rep_id
      where c.workspace_id = $1
        and c.status in ('open','awaiting_them','awaiting_us')
      order by c.last_activity_at desc
      limit 8`,
    [workspaceId],
  );
  return rows;
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function statusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case "awaiting_us":
      return {
        label: "needs you",
        cls: "bg-[var(--color-accent-bg)] text-[var(--color-accent)]",
      };
    case "awaiting_them":
      return {
        label: "awaiting them",
        cls: "bg-[var(--color-ink-3)] text-[var(--color-text-2)]",
      };
    default:
      return {
        label: status,
        cls: "bg-[var(--color-ink-3)] text-[var(--color-text-2)]",
      };
  }
}

export default async function MorningBriefPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <>
        <SectionHeader
          eyebrow="morning brief"
          title="No workspace yet"
          subtitle="Create one and seed Maya to see this dashboard come alive."
        />
        <EmptyState
          title="No workspace found"
          hint="Run the demo seed (core/plays/seed.ts → seedMayaForDemo) inside a fresh workspace, then refresh."
        />
      </>
    );
  }

  const [counts, signals, convs] = await Promise.all([
    loadTodayCounts(workspace.id),
    loadRecentSignals(workspace.id),
    loadActiveConversations(workspace.id),
  ]);

  return (
    <>
      <SectionHeader
        eyebrow="morning brief"
        title="What your Reps did overnight"
        subtitle="The last 24 hours, summarised. Click in for the trace."
      />

      <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
        <MetricCard label="Signals" value={counts.signals_24h} hint="last 24h" />
        <MetricCard label="Drafts" value={counts.drafts_24h} />
        <MetricCard label="Sent" value={counts.sent_24h} />
        <MetricCard label="Replies" value={counts.replies_24h} />
        <MetricCard label="Outcomes" value={counts.outcomes_24h} />
      </section>

      <section className="mb-10">
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Active conversations
        </h2>
        {convs.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            hint="When a Play sends an email, the conversation it opened will appear here."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {convs.map((c) => {
              const badge = statusBadge(c.status);
              return (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/conversations/${c.id}`}
                    className="flex items-center px-4 py-3 gap-4 hover:bg-[var(--color-ink-2)] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-sans text-sm text-[var(--color-text-1)] truncate">
                        {c.counterparty_name ?? "(unknown)"}
                        {c.rep_name ? (
                          <span className="text-[var(--color-text-3)] font-mono text-xs ml-2">
                            · {c.rep_name}
                          </span>
                        ) : null}
                      </p>
                      <p className="font-serif text-[var(--color-text-2)] text-sm truncate mt-0.5 italic">
                        {c.topic ?? "(no topic)"}
                      </p>
                    </div>
                    <span
                      className={
                        "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded " +
                        badge.cls
                      }
                    >
                      {badge.label}
                    </span>
                    <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums">
                      {c.outbound_count}↑ {c.inbound_count}↓
                    </span>
                    <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                      {timeAgo(new Date(c.last_activity_at))}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
          Recent signals
        </h2>
        {signals.length === 0 ? (
          <EmptyState
            title="No signals yet"
            hint="Ingestion will populate this view as your sources start landing in core/graph."
          />
        ) : (
          <ul className="divide-y divide-[var(--color-line-1)] border border-[var(--color-line-1)] rounded-lg overflow-hidden bg-[var(--color-ink-0)]">
            {signals.map((s) => (
              <li key={s.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] w-24">
                    {s.kind}
                  </span>
                  <p className="font-sans text-sm text-[var(--color-text-1)] flex-1 truncate">
                    {s.title}
                  </p>
                  {s.match_score ? (
                    <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums">
                      match {Number(s.match_score).toFixed(2)}
                    </span>
                  ) : null}
                  <span className="font-mono text-xs text-[var(--color-text-3)] tabular-nums w-20 text-right">
                    {timeAgo(new Date(s.freshness_at))}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
