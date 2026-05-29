import Link from "next/link";
import Icon from "@/components/Icon";
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
}

interface TodayCounts {
  signals_24h: number;
  drafts_24h: number;
  sent_24h: number;
  replies_24h: number;
  outcomes_24h: number;
}

interface Readiness {
  reps: number;
  profiles: number;
  accounts: number;
  plays: number;
  sources: number;
}

const EMPTY_COUNTS: TodayCounts = {
  signals_24h: 0,
  drafts_24h: 0,
  sent_24h: 0,
  replies_24h: 0,
  outcomes_24h: 0,
};

const EMPTY_READINESS: Readiness = {
  reps: 0,
  profiles: 0,
  accounts: 0,
  plays: 0,
  sources: 0,
};

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

async function loadReadiness(workspaceId: string): Promise<Readiness> {
  const pool = getPool();
  const { rows } = await pool.query<{
    reps: string;
    profiles: string;
    accounts: string;
    plays: string;
    sources: string;
  }>(
    `select
       (select count(*)::text from reps where workspace_id = $1) as reps,
       (select count(*)::text from workspace_icps where workspace_id = $1) as profiles,
       (select count(*)::text from channel_accounts where workspace_id = $1) as accounts,
       (select count(*)::text from plays where workspace_id = $1) as plays,
       (select count(*)::text from graph_sources where workspace_id = $1 and enabled) as sources`,
    [workspaceId],
  );
  return {
    reps: Number(rows[0].reps),
    profiles: Number(rows[0].profiles),
    accounts: Number(rows[0].accounts),
    plays: Number(rows[0].plays),
    sources: Number(rows[0].sources),
  };
}

async function loadRecentSignals(workspaceId: string): Promise<RecentSignalRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<RecentSignalRow>(
    `select id, kind::text as kind, title, freshness_at, match_score::text as match_score
       from signals
      where workspace_id = $1
      order by freshness_at desc
      limit 5`,
    [workspaceId],
  );
  return rows;
}

async function loadActiveConversations(workspaceId: string): Promise<ConversationRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ConversationRow>(
    `select c.id, c.status::text as status, c.topic, c.last_activity_at,
            p.full_name as counterparty_name,
            r.name as rep_name
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join reps r on r.id = c.rep_id
      where c.workspace_id = $1
        and c.status in ('open','awaiting_them','awaiting_us')
      order by
        case when c.status = 'awaiting_us' then 0 else 1 end,
        c.last_activity_at desc
      limit 4`,
    [workspaceId],
  );
  return rows;
}

function timeAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function BriefPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <BriefCanvas
        counts={EMPTY_COUNTS}
        readiness={EMPTY_READINESS}
        signals={[]}
        conversations={[]}
        workspaceName={null}
      />
    );
  }

  const [counts, readiness, signals, conversations] = await Promise.all([
    loadTodayCounts(workspace.id),
    loadReadiness(workspace.id),
    loadRecentSignals(workspace.id),
    loadActiveConversations(workspace.id),
  ]);

  return (
    <BriefCanvas
      counts={counts}
      readiness={readiness}
      signals={signals}
      conversations={conversations}
      workspaceName={workspace.name}
    />
  );
}

function BriefCanvas({
  counts,
  readiness,
  signals,
  conversations,
  workspaceName,
}: {
  counts: TodayCounts;
  readiness: Readiness;
  signals: RecentSignalRow[];
  conversations: ConversationRow[];
  workspaceName: string | null;
}) {
  const awaitingReplies = conversations.filter((c) => c.status === "awaiting_us");
  const needsReview = counts.drafts_24h + awaitingReplies.length;
  const outcomesToday = counts.replies_24h + counts.outcomes_24h;
  const workToday = counts.signals_24h + counts.sent_24h + counts.drafts_24h;
  const primaryConversation = conversations[0];
  const latestSignal = signals[0];
  const hasReadyShape = [readiness.profiles, readiness.reps, readiness.accounts, readiness.plays, readiness.sources].some((value) => value > 0);

  return (
    <section className="brief-canvas" aria-labelledby="brief-title">
      <div className="brief-stream brief-stream-one" />
      <div className="brief-stream brief-stream-two" />
      <div className="brief-stream brief-stream-three" />
      <div className="brief-constellation" aria-hidden="true">
        <span className="brief-mark brief-mark-a" />
        <span className="brief-mark brief-mark-b" />
        <span className="brief-mark brief-mark-c" />
        <span className="brief-mark brief-mark-d" />
      </div>

      <div className="brief-node brief-node-primary left-[6%] top-[7%]">
        <p className="brief-kicker">Brief</p>
        <h1 id="brief-title" className="mt-3 text-[38px] font-semibold leading-[1.03] tracking-[0] text-[var(--color-text-1)] sm:text-[56px]">
          Today&apos;s work, on one canvas.
        </h1>
        <p className="mt-4 max-w-[56ch] text-[15px] leading-7 text-[var(--color-text-2)]">
          {workspaceName
            ? `${workspaceName} is watching signals, preparing outreach, and bringing back only the moments that need a decision.`
            : "Set the profile once, then Bombsell can watch signals, prepare outreach, and bring back only the moments that need a decision."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link href="/dashboard/setup" className="brief-button brief-button-primary">
            <Icon name="tune" size={16} />
            Shape profile
          </Link>
          <Link href="/dashboard/approvals" className="brief-button">
            <Icon name="fact_check" size={16} />
            Review work
          </Link>
        </div>
      </div>

      <BriefNote
        className="right-[7%] top-[10%]"
        href="/dashboard/approvals"
        icon="fact_check"
        title="Needs review"
        value={needsReview === 0 ? "Clear" : needsReview}
        text={needsReview === 0 ? "Nothing is waiting for approval." : "Drafts or replies need a human look."}
      />

      <BriefNote
        className="bottom-[13%] left-[9%]"
        href="/dashboard/conversations"
        icon="mark_email_read"
        title="Recent outcomes"
        value={outcomesToday === 0 ? "Quiet" : outcomesToday}
        text={
          primaryConversation
            ? `${primaryConversation.counterparty_name ?? "Open conversation"} moved ${timeAgo(new Date(primaryConversation.last_activity_at))} ago.`
            : "Replies and booked outcomes will surface here."
        }
      />

      <BriefNote
        className="bottom-[10%] right-[10%]"
        href="/dashboard/ingestion"
        icon="radar"
        title="Today's work"
        value={workToday === 0 ? (hasReadyShape ? "Watching" : "Start") : workToday}
        text={
          latestSignal
            ? latestSignal.title
            : "Signals, safe sends, and prepared drafts will appear as the system works."
        }
      />
    </section>
  );
}

function BriefNote({
  className,
  href,
  icon,
  title,
  value,
  text,
}: {
  className: string;
  href: string;
  icon: string;
  title: string;
  value: number | string;
  text: string;
}) {
  return (
    <Link href={href} className={`brief-node brief-note ${className}`}>
      <span className="brief-note-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--color-text-1)]">
          {title}
        </span>
        <span className="mt-2 block text-[28px] font-semibold leading-none tabular-nums text-[var(--color-text-1)]">
          {value}
        </span>
        <span className="mt-3 line-clamp-2 block text-sm leading-6 text-[var(--color-text-2)]">
          {text}
        </span>
      </span>
    </Link>
  );
}
