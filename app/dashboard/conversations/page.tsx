import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import { decideApprovalWithDraftAction } from "../actions";

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
  signal_kind: string | null;
  latest_message_body: string | null;
  latest_message_subject: string | null;
  latest_message_direction: string | null;
  latest_message_status: string | null;
  latest_message_created_at: Date | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  pending_approval_id: string | null;
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
            s.title as signal_title,
            s.kind::text as signal_kind,
            lm.body as latest_message_body,
            lm.subject as latest_message_subject,
            lm.direction::text as latest_message_direction,
            lm.status::text as latest_message_status,
            lm.created_at as latest_message_created_at,
            lm.eval_score::text as eval_score,
            lm.eval_passed,
            pending.id as pending_approval_id
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join reps r on r.id = c.rep_id
       left join signals s on s.id = c.origin_signal_id
       left join lateral (
         select m.id, m.body, m.subject, m.direction, m.status, m.created_at, m.eval_score, m.eval_passed
           from messages m
          where m.workspace_id = c.workspace_id and m.conversation_id = c.id
          order by m.created_at desc
          limit 1
       ) lm on true
       left join lateral (
         select a.id
           from workflow_approvals a
          where a.workspace_id = c.workspace_id
            and a.decision = 'pending'
            and a.payload ? 'message_id'
            and a.payload->>'message_id' = lm.id::text
          order by a.created_at desc
          limit 1
       ) pending on true
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
      <SurfaceHero
        kicker="Outreach"
        title="No workspace selected."
        description="Create a prospecting profile first, then email and LinkedIn replies collect here."
      />
    );
  }
  const conversations = await loadConversations(workspace.id);
  const awaitingReply = conversations.filter((c) => c.status === "awaiting_us").length;
  const stats = await loadOutreachStats(workspace.id, awaitingReply);

  return (
    <div className="space-y-2">
      <SurfaceHero
        kicker="Email + LinkedIn"
        title={<>Move the <em>useful</em> conversations.</>}
        description="Drafts, approvals, replies, and next moves across connected inboxes and LinkedIn. Everything is tied back to the signal that made now worth reaching out."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Awaiting reply" value={stats.awaiting_reply} />
            <HeroStat label="Replies 7d" value={stats.positive_replies_7d} />
            <HeroStat label="Booked 7d" value={stats.meetings_booked_7d} />
          </div>
        }
      />

      <SurfaceSection title="Conversations">
        {conversations.length === 0 ? (
          <EmptyState
            title="No outreach replies yet"
            hint="Once a signal starts an email or LinkedIn Play, replies and review moments will appear here."
            cta={{ href: "/dashboard/prospecting", label: "Tune prospecting", icon: "person" }}
          />
        ) : (
          <div className="grid gap-2">
            {conversations.map((conversation) => (
              <ConversationLink key={conversation.id} conversation={conversation} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function ConversationLink({ conversation }: { conversation: ConversationRow }) {
  const badge =
    STATUS_LABEL[conversation.status] ?? {
      label: conversation.status.replace(/_/g, " "),
      tone: "bg-[var(--color-ink-2)] text-[var(--color-text-3)]",
    };
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[rgba(20,18,13,0.78)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[rgba(30,26,18,0.95)] md:grid-cols-[1fr_auto] md:items-center">
      <Link
        href={`/dashboard/conversations/${conversation.id}`}
        prefetch={false}
        className="min-w-0"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
            <Icon name={repIcon(conversation.rep_name)} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
              {conversation.counterparty_name ?? "Unknown person"}
              {conversation.company_name ? (
                <span className="font-normal text-[var(--color-text-3)]">
                  {" "}
                  at {conversation.company_name}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-3)]">
              {conversation.rep_name ?? "Sampark"} · {messageDigest(conversation)}
            </span>
          </span>
        </div>
        <p className="mt-3 truncate text-sm text-[var(--color-text-2)]">
          {conversation.topic ?? conversation.signal_title ?? "No topic yet"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {conversation.signal_title ? (
            <span className="max-w-[320px] truncate rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
              Why now: {conversation.signal_title}
            </span>
          ) : null}
          {conversation.pending_approval_id || conversation.eval_passed != null ? (
            <span className="rounded-[8px] bg-[rgba(20,18,13,0.66)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
              {conversation.pending_approval_id || conversation.eval_passed === false
                ? "Needs review"
                : "Ready"}
            </span>
          ) : null}
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-3 md:justify-end">
        <span className={"rounded-[8px] px-2.5 py-1 text-xs font-medium " + badge.tone}>
          {badge.label}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {freshWhen(conversation.latest_message_created_at ?? conversation.last_activity_at)}
        </span>
        {conversation.pending_approval_id ? (
          <>
            <Link
              href="/dashboard/review"
              prefetch={false}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(20,18,13,0.78)] px-3 text-xs font-semibold text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-ink-2)]"
            >
              <Icon name="rate_review" size={14} />
              Review
            </Link>
            <form action={decideApprovalWithDraftAction}>
              <input type="hidden" name="return_to" value="/dashboard/conversations" />
              <input type="hidden" name="approval_id" value={conversation.pending_approval_id} />
              <input type="hidden" name="decision" value="approved" />
              <PendingSubmitButton
                className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] bg-[var(--color-text-1)] px-3 text-xs font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
                icon="check"
                iconSize={14}
                pendingLabel="Approving"
              >
                Approve
              </PendingSubmitButton>
            </form>
            <form action={decideApprovalWithDraftAction}>
              <input type="hidden" name="return_to" value="/dashboard/conversations" />
              <input type="hidden" name="approval_id" value={conversation.pending_approval_id} />
              <input type="hidden" name="decision" value="rejected" />
              <PendingSubmitButton
                className="inline-flex min-h-8 items-center gap-1.5 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(20,18,13,0.78)] px-3 text-xs font-semibold text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-ink-2)]"
                icon="close"
                iconSize={14}
                pendingLabel="Rejecting"
              >
                Reject
              </PendingSubmitButton>
            </form>
          </>
        ) : null}
      </div>
    </article>
  );
}

function messageDigest(conversation: ConversationRow): string {
  const prefix =
    conversation.latest_message_direction === "inbound"
      ? "Reply"
      : conversation.latest_message_status
        ? conversation.latest_message_status.replace(/_/g, " ")
        : "No message";
  const text =
    conversation.latest_message_subject ??
    conversation.latest_message_body ??
    conversation.topic ??
    conversation.signal_title;
  if (!text) return prefix;
  return `${prefix}: ${text.length > 92 ? text.slice(0, 92) + "..." : text}`;
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

function repIcon(name: string | null): string {
  if (name === "Sampark") return "forum";
  if (name === "Prayog") return "science";
  return "person";
}
