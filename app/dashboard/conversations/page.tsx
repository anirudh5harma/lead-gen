import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface ConversationRow {
  id: string;
  status: string;
  topic: string | null;
  started_at: Date;
  last_activity_at: Date;
  counterparty_name: string | null;
  company_name: string | null;
  rep_name: string | null;
  signal_title: string | null;
}

interface OutreachOutcomeStats {
  positive_replies_7d: number;
  meetings_booked_7d: number;
  awaiting_reply: number;
}

async function loadConversations(workspaceId: string): Promise<ConversationRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<ConversationRow>(
    `select c.id, c.status::text as status, c.topic, c.started_at, c.last_activity_at,
            p.full_name as counterparty_name,
            co.name as company_name,
            r.name as rep_name,
            s.title as signal_title
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join reps r on r.id = c.rep_id
       left join signals s on s.id = c.origin_signal_id
      where c.workspace_id = $1
      order by c.last_activity_at desc
      limit 100`,
    [workspaceId],
  );
  return rows;
}

async function loadOutreachStats(
  workspaceId: string,
  awaitingReply: number,
): Promise<OutreachOutcomeStats> {
  const pool = getPool();
  const { rows } = await pool.query<{
    positive_replies_7d: string;
    meetings_booked_7d: string;
  }>(
    `select
       (select count(*)::text from outcomes
          where workspace_id = $1 and kind = 'positive_reply'
            and recorded_at >= now() - interval '7 days') as positive_replies_7d,
       (select count(*)::text from outcomes
          where workspace_id = $1 and kind = 'meeting_booked'
            and recorded_at >= now() - interval '7 days') as meetings_booked_7d`,
    [workspaceId],
  );
  return {
    positive_replies_7d: Number(rows[0]?.positive_replies_7d ?? 0),
    meetings_booked_7d: Number(rows[0]?.meetings_booked_7d ?? 0),
    awaiting_reply: awaitingReply,
  };
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-[var(--color-ink-2)] text-[var(--color-text-2)]" },
  awaiting_us: {
    label: "Needs reply",
    tone: "bg-[var(--color-accent-bg)] text-[var(--color-accent)]",
  },
  awaiting_them: {
    label: "Sent",
    tone: "bg-[var(--color-ink-2)] text-[var(--color-text-2)]",
  },
  paused: {
    label: "Paused",
    tone: "bg-[var(--color-ink-2)] text-[var(--color-text-2)]",
  },
  closed_positive: {
    label: "Won",
    tone: "bg-[var(--color-pos-bg)] text-[var(--color-pos)]",
  },
  closed_negative: {
    label: "Closed",
    tone: "bg-[var(--color-neg-bg)] text-[var(--color-neg)]",
  },
  closed_no_response: {
    label: "Quiet",
    tone: "bg-[var(--color-ink-2)] text-[var(--color-text-3)]",
  },
};

export default async function ConversationsPage() {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <section className="section-canvas p-6">
        <p className="brief-kicker">Sampark · Outreach</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          No workspace selected.
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--color-text-2)]">
          Create a profile first, then Sampark&apos;s replies will collect here.
        </p>
      </section>
    );
  }
  const conversations = await loadConversations(workspace.id);
  const awaitingReply = conversations.filter((c) => c.status === "awaiting_us").length;
  const stats = await loadOutreachStats(workspace.id, awaitingReply);
  const latest = conversations[0];

  return (
    <>
      <section className="section-canvas overflow-hidden p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-end">
          <div>
            <p className="brief-kicker">Sampark · Outreach</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Sampark is keeping conversations moving.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Replies, next moves, and where Sampark wants you to step in. Everything else stays quiet.
            </p>
          </div>
          <div className="section-note">
            <div className="grid grid-cols-3 gap-2 text-center">
              <OutreachStat label="Awaiting reply" value={stats.awaiting_reply} />
              <OutreachStat label="Replies (7d)" value={stats.positive_replies_7d} />
              <OutreachStat label="Booked (7d)" value={stats.meetings_booked_7d} />
            </div>
            <p className="mt-4 text-sm leading-6 text-[var(--color-text-2)]">
              {latest
                ? `${latest.counterparty_name ?? "A contact"} was last active ${new Date(latest.last_activity_at).toLocaleDateString()}.`
                : "New replies will surface here once Sampark starts."}
            </p>
          </div>
        </div>
      </section>

      {conversations.length === 0 ? (
        <EmptyState
          title="No outreach replies yet"
          hint="Once Sampark begins, replies and review moments will appear here."
        />
      ) : (
        <section className="mt-6 section-canvas overflow-hidden p-3">
          <div className="grid gap-2">
            {conversations.map((conversation) => (
              <ConversationLink key={conversation.id} conversation={conversation} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ConversationLink({ conversation }: { conversation: ConversationRow }) {
  const badge =
    STATUS_LABEL[conversation.status] ?? {
      label: conversation.status.replace(/_/g, " "),
      tone: "bg-[var(--color-ink-2)] text-[var(--color-text-3)]",
    };
  return (
    <Link
      href={`/dashboard/conversations/${conversation.id}`}
      className="grid gap-3 rounded-[12px] bg-[rgba(255,255,255,0.68)] px-4 py-4 transition-colors hover:bg-[rgba(255,255,255,0.92)] md:grid-cols-[1fr_auto] md:items-center"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon name="north_east" size={16} className="text-[var(--color-accent)]" />
          <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
            {conversation.counterparty_name ?? "Unknown person"}
            {conversation.company_name ? (
              <span className="font-normal text-[var(--color-text-3)]">
                {" "}
                at {conversation.company_name}
              </span>
            ) : null}
          </p>
        </div>
        <p className="mt-1 truncate text-sm text-[var(--color-text-2)]">
          {conversation.topic ?? conversation.signal_title ?? "No topic yet"}
        </p>
      </div>
      <div className="flex items-center gap-3 md:justify-end">
        <span className={"rounded-full px-2.5 py-1 text-xs font-medium " + badge.tone}>
          {badge.label}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {new Date(conversation.last_activity_at).toLocaleDateString()}
        </span>
      </div>
    </Link>
  );
}

function OutreachStat({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.6)] p-3">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">
        {value}
      </strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}
