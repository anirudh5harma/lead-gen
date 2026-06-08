import { notFound } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  getConversationTrustTrace,
  type ConversationTrustApproval,
  type ConversationTrustConversation,
  type ConversationTrustMessage,
  type ConversationTrustOutcome,
  type ConversationTrustReplyProof,
} from "@/core/product/conversation-trust";
import { getActiveWorkspace } from "@/lib/workspace";
import { decideApprovalWithDraftAction } from "../../actions";

export const dynamic = "force-dynamic";

function preview(body: string | null, max = 600): string {
  if (!body) return "(empty)";
  return body.length > max ? body.slice(0, max) + "…" : body;
}

function TrustTracePanel({
  conversation,
  messages,
  approvals,
  outcomes,
  replyProofs,
}: {
  conversation: ConversationTrustConversation;
  messages: ConversationTrustMessage[];
  approvals: ConversationTrustApproval[];
  outcomes: ConversationTrustOutcome[];
  replyProofs: ConversationTrustReplyProof[];
}) {
  const outbound =
    [...messages].reverse().find((message) => message.direction === "outbound") ??
    messages[0] ??
    null;
  const latestApproval = approvals.at(-1) ?? null;
  const latestOutcome = outcomes.at(-1) ?? null;
  const critique =
    textValue(outbound?.eval_notes?.critique) ??
    textValue(outbound?.eval_notes?.draft_rejection_reason);
  const latestReplyProof = replyProofs.at(-1) ?? null;

  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">Proof</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
        Why Sampark moved, what was checked, and what came back.
      </p>
      <div className="mt-4 grid gap-3">
        <TraceRow
          label="Why now"
          value={conversation.signal_title ?? conversation.topic ?? "No signal anchor"}
        />
        <TraceRow
          label="Message check"
          value={
            outbound?.eval_passed === false
              ? "Needs review"
              : outbound?.eval_passed === true
                ? "Ready"
                : "Waiting for review"
          }
          meta={critique ?? undefined}
        />
        <TraceRow
          label="Reply"
          value={latestReplyProof?.summary ?? "No reply yet"}
          meta={latestReplyProof ? replyProofMeta(latestReplyProof) ?? undefined : undefined}
        />
        <TraceRow
          label="Approval"
          value={
            latestApproval
              ? approvalLabel(latestApproval.decision)
              : "No manual review requested"
          }
          meta={latestApproval?.reason ?? undefined}
        />
        <TraceRow
          label="Result"
          value={
            latestOutcome
              ? outcomeLabel(latestOutcome.kind)
              : "No result recorded yet"
          }
          meta={latestOutcome ? formatWhen(latestOutcome.occurred_at) : undefined}
        />
      </div>
    </div>
  );
}

function TraceRow({
  label,
  value,
  meta,
}: {
  label: string;
  value: string;
  meta?: string;
}) {
  return (
    <div className="border-t border-[var(--color-line-1)] pt-3 first:border-t-0 first:pt-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-4)]">
        {label}
      </p>
      <p className="mt-1 text-sm leading-5 text-[var(--color-text-1)]">{value}</p>
      {meta ? (
        <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">{meta}</p>
      ) : null}
    </div>
  );
}

function PendingApprovalPanel({ approval }: { approval: ConversationTrustApproval }) {
  const subject = stringPayload(approval.payload, "subject") ?? "(no subject)";
  const body = stringPayload(approval.payload, "body") ?? "(empty)";

  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">Review draft</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
        {approval.reason ?? "This outreach is waiting for a human decision."}
      </p>
      <form action={decideApprovalWithDraftAction} className="mt-4 grid gap-3">
        <input type="hidden" name="approval_id" value={approval.id} />
        <input type="hidden" name="decision" value="approved" />
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-3)]">Subject</span>
          <input
            name="subject"
            defaultValue={subject}
            className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)] px-3 text-sm text-[var(--color-text-1)]"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-3)]">Body</span>
          <textarea
            name="body"
            rows={8}
            defaultValue={body}
            className="rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-[var(--color-text-1)] px-4 text-sm font-semibold text-[var(--color-ink-0)] transition-colors hover:bg-[var(--color-accent)]"
        >
          Approve
        </button>
      </form>
      <form action={decideApprovalWithDraftAction} className="mt-3">
        <input type="hidden" name="approval_id" value={approval.id} />
        <input type="hidden" name="decision" value="rejected" />
        <button
          type="submit"
          className="inline-flex min-h-10 w-full items-center justify-center rounded-[8px] border border-[var(--color-line-1)] bg-[rgba(255,255,255,0.68)] px-4 text-sm font-semibold text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-ink-2)]"
        >
          Reject
        </button>
      </form>
    </div>
  );
}

function stringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function replyProofMeta(proof: ConversationTrustReplyProof): string | null {
  const pieces = [
    proof.exemplar_count
      ? `${proof.exemplar_count} useful ${proof.exemplar_count === 1 ? "example" : "examples"}`
      : null,
    proof.channel_event_type ? channelEventLabel(proof.channel_event_type) : null,
  ].filter((piece): piece is string => Boolean(piece));
  return pieces.length ? pieces.join(" · ") : null;
}

function approvalLabel(decision: string): string {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  if (decision === "pending") return "Needs review";
  return decision.replace(/_/g, " ");
}

function outcomeLabel(kind: string): string {
  if (kind === "positive_reply") return "Positive reply";
  if (kind === "meeting_booked") return "Meeting booked";
  if (kind === "post_published") return "Post published";
  if (kind === "engagement_lift") return "Lift";
  return kind.replace(/_/g, " ");
}

function channelEventLabel(eventType: string): string {
  if (eventType === "message.sent") return "Sent";
  if (eventType === "message.delivered") return "Delivered";
  if (eventType === "message.bounced") return "Bounced";
  if (eventType === "message.deferred") return "Held for review";
  return eventType.replace(/_/g, " ").replace(/\./g, " ");
}

function formatWhen(value: Date): string {
  return new Date(value).toLocaleString();
}

function messageDirectionLabel(direction: string): string {
  if (direction === "outbound") return "Sampark";
  if (direction === "inbound") return "Reply";
  return direction.replace(/_/g, " ");
}

function messageStatusLabel(status: string): string {
  if (status === "sent") return "Sent";
  if (status === "delivered") return "Delivered";
  if (status === "draft") return "Draft";
  if (status === "queued") return "Ready";
  if (status === "deferred") return "Held for review";
  if (status === "failed") return "Failed";
  if (status === "bounced") return "Bounced";
  return status.replace(/_/g, " ");
}

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return (
      <section className="section-canvas p-6">
        <p className="brief-kicker">Outreach</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          No workspace selected.
        </h1>
      </section>
    );
  }
  const trace = await getConversationTrustTrace({
    workspace_id: workspace.id,
    conversation_id: id,
  });
  if (!trace) return notFound();
  const {
    conversation: conv,
    messages,
    approvals,
    outcomes,
    reply_proofs: replyProofs,
  } = trace;
  const pendingApproval =
    approvals.filter((approval) => approval.decision === "pending").at(-1) ?? null;

  return (
    <>
      <section className="section-canvas min-h-[300px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <p className="brief-kicker">Outreach</p>
        <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
          {conv.counterparty_name ?? "Unknown contact"}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
          {conv.topic ?? conv.signal_title ?? "Conversation detail and proof of work."}
        </p>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--color-text-1)]">Messages</h2>
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" />
          ) : (
            <ul className="grid gap-4">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={
                    "rounded-[14px] border p-4 " +
                    (m.direction === "outbound"
                      ? "border-[var(--color-line-1)] bg-[rgba(255,255,255,0.72)]"
                      : "border-[var(--color-line-2)] bg-[rgba(238,238,234,0.72)]")
                  }
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[rgba(255,255,255,0.64)] px-2 py-1 text-xs text-[var(--color-text-3)]">
                      {messageDirectionLabel(m.direction)}
                    </span>
                    <span
                      className={
                        "rounded-full px-2 py-1 text-xs " +
                        (m.status === "sent" || m.status === "delivered"
                          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
                          : m.status === "bounced" || m.status === "failed"
                            ? "bg-[var(--color-neg-bg)] text-[var(--color-neg)]"
                            : m.status === "deferred"
                              ? "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                              : "bg-[var(--color-ink-3)] text-[var(--color-text-2)]")
                      }
                    >
                      {messageStatusLabel(m.status)}
                    </span>
                    {m.intent_class ? (
                      <span className="rounded-full bg-[var(--color-ink-3)] px-2 py-1 text-xs text-[var(--color-text-2)]">
                        Reply: {m.intent_class.replace(/_/g, " ")}
                      </span>
                    ) : null}
                    {m.eval_score ? (
                      <span className="rounded-full bg-[var(--color-ink-3)] px-2 py-1 text-xs text-[var(--color-text-2)]">
                        {m.eval_passed === false ? "Needs review" : "Ready"}
                      </span>
                    ) : null}
                    <span className="ml-auto text-xs text-[var(--color-text-3)]">
                      {new Date(m.sent_at ?? m.created_at).toLocaleString()}
                    </span>
                  </div>
                  {m.subject ? (
                    <p className="font-sans text-sm text-[var(--color-text-1)] font-medium mb-2">
                      {m.subject}
                    </p>
                  ) : null}
                  <p className="font-sans text-sm text-[var(--color-text-2)] whitespace-pre-wrap leading-relaxed">
                    {preview(m.body)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="grid gap-4">
          {pendingApproval ? <PendingApprovalPanel approval={pendingApproval} /> : null}

          <TrustTracePanel
            conversation={conv}
            messages={messages}
            approvals={approvals}
            outcomes={outcomes}
            replyProofs={replyProofs}
          />

          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Contact</p>
            <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
              {conv.counterparty_name}
            </p>
            {conv.company_name ? (
              <p className="font-sans text-xs text-[var(--color-text-2)] mt-0.5">
                {conv.company_name}
              </p>
            ) : null}
            {conv.counterparty_emails?.[0] ? (
              <p className="text-xs text-[var(--color-text-3)] mt-1">
                {conv.counterparty_emails[0]}
              </p>
            ) : null}
            {conv.rep_name ? (
              <p className="text-xs text-[var(--color-text-3)] mt-3">
                Voice <span className="text-[var(--color-text-1)]">{conv.rep_name}</span>
              </p>
            ) : null}
          </div>

          {conv.signal_title ? (
            <div className="section-note">
              <p className="text-sm font-semibold text-[var(--color-text-1)]">Why now</p>
              <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
                {conv.signal_title}
              </p>
            </div>
          ) : null}

          <p className="text-xs text-[var(--color-text-3)]">
            <Link
              href="/dashboard/conversations"
              prefetch={false}
              className="hover:text-[var(--color-text-1)]"
            >
              Back to outreach
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}
