import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import { HeroStat, SurfaceHero, SurfaceSection } from "@/components/dashboard/SurfaceHero";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";
import { decideApprovalWithDraftAction } from "../actions";

export const dynamic = "force-dynamic";

interface OutboundMessageRow {
  id: string;
  conversation_id: string;
  status: string;
  channel: string;
  subject: string | null;
  body: string | null;
  sent_at: Date | null;
  created_at: Date;
  counterparty_name: string | null;
  company_name: string | null;
  signal_title: string | null;
  signal_kind: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  pending_approval_id: string | null;
}

interface OutreachOutcomeStats {
  positive_replies_7d: number;
  meetings_booked_7d: number;
  awaiting_reply: number;
}

async function loadOutboundMessages(workspaceId: string): Promise<OutboundMessageRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<OutboundMessageRow>(
    `select m.id,
            m.conversation_id,
            m.status::text as status,
            m.channel::text as channel,
            m.subject,
            m.body,
            m.sent_at,
            m.created_at,
            p.full_name as counterparty_name,
            co.name as company_name,
            s.title as signal_title,
            s.kind::text as signal_kind,
            m.eval_score::text as eval_score,
            m.eval_passed,
            pending.id as pending_approval_id
       from messages m
       join conversations c on c.id = m.conversation_id
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join signals s on s.id = c.origin_signal_id
       left join lateral (
         select a.id
          from workflow_approvals a
         where a.workspace_id = m.workspace_id
            and a.decision = 'pending'
            and a.payload ? 'message_id'
            and a.payload->>'message_id' = m.id::text
          order by a.created_at desc
          limit 1
       ) pending on true
      where m.workspace_id = $1
        and m.direction = 'outbound'
        and m.channel in ('email','linkedin_dm','linkedin_inmail','linkedin_connection','linkedin_comment')
        and m.status in ('sent','delivered','replied')
      order by coalesce(m.sent_at, m.created_at) desc
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
  sent: { label: "Sent", tone: "bg-[var(--color-ink-2)] text-[var(--color-text-2)]" },
  delivered: { label: "Delivered", tone: "bg-[var(--color-pos-bg)] text-[var(--color-pos)]" },
  replied: { label: "Replied", tone: "bg-[var(--color-pos-bg)] text-[var(--color-pos)]" },
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
        kicker="Inbox"
        title="No workspace selected."
        description="Create a prospecting profile first, then email and LinkedIn replies collect here."
      />
    );
  }
  const messages = await loadOutboundMessages(workspace.id);
  const awaitingReply = messages.filter((m) => m.status === "sent" || m.status === "delivered").length;
  const stats = await loadOutreachStats(workspace.id, awaitingReply);

  return (
    <div className="space-y-10">
      <SurfaceHero
        kicker="Outreach"
        title={<>Sent email and LinkedIn <em>drafts</em>.</>}
        description="Every outbound email, DM, and connection touch with the contact, company, signal, and draft you can inspect."
        meta={
          <div className="flex flex-wrap gap-2">
            <HeroStat label="Awaiting reply" value={stats.awaiting_reply} />
            <HeroStat label="Replies 7d" value={stats.positive_replies_7d} />
            <HeroStat label="Booked 7d" value={stats.meetings_booked_7d} />
          </div>
        }
      />

      <SurfaceSection title="Sent list">
        {messages.length === 0 ? (
          <EmptyState
            title="No outreach sent yet"
            hint="Once a signal starts email or LinkedIn outreach, sent drafts will appear here."
            cta={{ href: "/dashboard/integrations", label: "Connect accounts", icon: "account_tree" }}
          />
        ) : (
          <div className="grid gap-2">
            {messages.map((message) => (
              <OutboundMessageLink key={message.id} message={message} />
            ))}
          </div>
        )}
      </SurfaceSection>
    </div>
  );
}

function OutboundMessageLink({ message }: { message: OutboundMessageRow }) {
  const badge =
    STATUS_LABEL[message.status] ?? {
      label: message.status.replace(/_/g, " "),
      tone: "bg-[var(--color-ink-2)] text-[var(--color-text-3)]",
    };
  return (
    <article className="grid gap-3 rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-4 py-4 transition-colors hover:border-[var(--color-line-3)] hover:bg-[var(--color-ink-2)] md:grid-cols-[1fr_auto] md:items-center">
      <Link
        href={`/dashboard/conversations/${message.conversation_id}`}
        prefetch={false}
        className="min-w-0"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--color-ink-2)] text-[var(--color-text-2)]">
            <Icon name={channelIcon(message.channel)} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-[var(--color-text-1)]">
              {message.counterparty_name ?? "Unknown person"}
              {message.company_name ? (
                <span className="font-normal text-[var(--color-text-3)]">
                  {" "}
                  at {message.company_name}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 block truncate text-xs text-[var(--color-text-3)]">
              {channelLabel(message.channel)} · {message.subject ?? messageDigest(message)}
            </span>
          </span>
        </div>
        <p className="mt-3 truncate text-sm text-[var(--color-text-2)]">
          {message.body ?? "No draft body stored"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {message.signal_title ? (
            <span className="max-w-[320px] truncate rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
              Why now: {message.signal_title}
            </span>
          ) : null}
          {message.pending_approval_id || message.eval_passed != null ? (
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 text-xs text-[var(--color-text-2)]">
              {message.pending_approval_id || message.eval_passed === false
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
          {freshWhen(message.sent_at ?? message.created_at)}
        </span>
        {message.pending_approval_id ? (
          <>
            <Link
              href="/dashboard/review"
              prefetch={false}
              className="btn-quiet-sm"
            >
              <Icon name="rate_review" size={14} />
              Review
            </Link>
            <form action={decideApprovalWithDraftAction}>
              <input type="hidden" name="return_to" value="/dashboard/conversations" />
              <input type="hidden" name="approval_id" value={message.pending_approval_id} />
              <input type="hidden" name="decision" value="approved" />
              <PendingSubmitButton
                className="btn-solid-sm"
                icon="check"
                iconSize={14}
                pendingLabel="Approving"
              >
                Approve
              </PendingSubmitButton>
            </form>
            <form action={decideApprovalWithDraftAction}>
              <input type="hidden" name="return_to" value="/dashboard/conversations" />
              <input type="hidden" name="approval_id" value={message.pending_approval_id} />
              <input type="hidden" name="decision" value="rejected" />
              <PendingSubmitButton
                className="btn-quiet-sm"
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

function messageDigest(message: OutboundMessageRow): string {
  const prefix = message.status ? message.status.replace(/_/g, " ") : "Draft";
  const text = message.body ?? message.signal_title;
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

function channelIcon(channel: string): string {
  if (channel === "email") return "mail";
  if (channel.startsWith("linkedin")) return "forum";
  return "send";
}

function channelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin_dm") return "LinkedIn DM";
  if (channel === "linkedin_inmail") return "LinkedIn InMail";
  if (channel === "linkedin_connection") return "LinkedIn connect";
  if (channel === "linkedin_comment") return "LinkedIn comment";
  return channel.replace(/_/g, " ");
}
