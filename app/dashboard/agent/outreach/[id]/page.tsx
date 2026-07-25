import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import {
  getConversationTrustTrace,
  type ConversationTrustApproval,
  type ConversationTrustConversation,
  type ConversationTrustEvent,
  type ConversationTrustGateExplanation,
  type ConversationTrustMessage,
  type ConversationTrustOutcome,
  type ConversationTrustReplyProof,
  type ConversationTrustTrace,
} from "@/core/product/conversation-trust";
import { getActiveWorkspaceSessionForDashboard } from "@/lib/workspace";
import {
  decideApprovalWithDraftAction,
  generateMeetingPrepAction,
} from "@/app/dashboard/actions";
import { loadDashboardData } from "../../../server-data";

export const dynamic = "force-dynamic";

type ConversationTrustTraceLoadResult =
  | { status: "found"; trace: ConversationTrustTrace }
  | { status: "missing" }
  | { status: "unavailable" };

function preview(body: string | null, max = 600): string {
  if (!body) return "(empty)";
  return body.length > max ? body.slice(0, max) + "…" : body;
}

function OutreachProofTimeline({
  conversation,
  messages,
  outcomes,
  replyProofs,
  gateExplanations,
  workflow,
}: {
  conversation: ConversationTrustConversation;
  messages: ConversationTrustMessage[];
  outcomes: ConversationTrustOutcome[];
  replyProofs: ConversationTrustReplyProof[];
  gateExplanations: ConversationTrustGateExplanation[];
  workflow: ConversationTrustTrace["workflow"];
}) {
  const outbound =
    [...messages].reverse().find((message) => message.direction === "outbound") ??
    null;
  const latestOutcome = outcomes.at(-1) ?? null;
  const latestReplyProof = replyProofs.at(-1) ?? null;
  const strongestGate = strongestGateExplanation(
    gateExplanations.filter((gate) =>
      gate.kind === "judge" || gate.kind === "brand_voice"
    ),
  );
  const channelGate = strongestGateExplanation(
    gateExplanations.filter((gate) =>
      gate.kind === "channel" || gate.kind === "deliverability"
    ),
  );
  const workflowStepCount = workflow?.steps.length ?? 0;
  const completedStepCount =
    workflow?.steps.filter((step) => step.status === "completed").length ?? 0;
  const timelineItems: TimelineItemData[] = [
    {
      key: "signal",
      icon: "sensors",
      label: "Signal",
      title: conversation.signal_title ?? conversation.topic ?? "No signal anchor",
      detail: [
        conversation.signal_kind
          ? conversation.signal_kind.replace(/_/g, " ")
          : null,
        conversation.signal_url ? "Source linked" : null,
      ].filter(Boolean).join(" · ") || "Timing evidence is still being resolved.",
      href: conversation.signal_url,
      tone: conversation.signal_title ? "ready" : "neutral",
    },
    {
      key: "contact",
      icon: "verified",
      label: "Contact proof",
      title: conversation.counterparty_name ?? "Unknown contact",
      detail: [
        contactEmailStatusLabel(conversation.counterparty_email_status),
        conversation.counterparty_linkedin_ready
          ? "LinkedIn profile"
          : "LinkedIn missing",
        conversation.counterparty_fit_decision
          ? contactFitLabel(conversation.counterparty_fit_decision)
          : "Fit pending",
      ].join(" · "),
      href: conversation.counterparty_person_id
        ? `/dashboard/agent/contacts/${conversation.counterparty_person_id}`
        : null,
      tone:
        conversation.counterparty_email_status === "verified" ||
        conversation.counterparty_linkedin_ready
          ? "ready"
          : "attention",
    },
    {
      key: "draft",
      icon: "fact_check",
      label: "Draft and judge",
      title: outbound
        ? `${channelLabel(outbound.channel)} ${messageStatusLabel(outbound.status)}`
        : "No outbound draft yet",
      detail: outbound
        ? outreachJudgeSummary(outbound, strongestGate)
        : "The agent has not produced channel-ready outreach for this conversation.",
      href: outbound ? `#message-${outbound.id}` : null,
      tone:
        outbound?.eval_passed === false
          ? "blocked"
          : outbound?.eval_passed === true
            ? "ready"
            : "neutral",
    },
    {
      key: "channel",
      icon: "account_tree",
      label: "Channel",
      title: channelGate?.summary ?? "Channel evidence pending",
      detail:
        channelGate?.detail ??
        (outbound
          ? `${channelLabel(outbound.channel)} status: ${messageStatusLabel(outbound.status)}`
          : "No email or LinkedIn send proof yet."),
      href: null,
      tone:
        channelGate?.severity === "block"
          ? "blocked"
          : channelGate?.severity === "warn"
            ? "attention"
            : channelGate
              ? "ready"
              : "neutral",
    },
    {
      key: "outcome",
      icon: "forum",
      label: "Reply or meeting",
      title: latestOutcome
        ? outcomeLabel(latestOutcome.kind)
        : latestReplyProof?.summary ?? "No outcome yet",
      detail: latestOutcome
        ? formatWhen(latestOutcome.occurred_at)
        : latestReplyProof
          ? "Reply proof captured from the conversation trace."
          : "Replies, meetings, and useful outcomes will appear here.",
      href:
        latestReplyProof?.inbound_message_id
          ? `#message-${latestReplyProof.inbound_message_id}`
          : null,
      tone: latestOutcome || latestReplyProof ? "ready" : "neutral",
    },
  ];

  return (
    <section className="section-note">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">
            Signal-to-outreach trace
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--color-text-3)]">
            The proof chain for this email or LinkedIn touch: timing signal,
            verified contact, judged draft, channel handoff, and reply learning.
          </p>
        </div>
        {workflow ? (
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-text-3)]">
            {workflow.run.workflow_name} · {completedStepCount}/{workflowStepCount} steps
          </span>
        ) : null}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-5">
        {timelineItems.map((item) => (
          <TimelineItem key={item.key} item={item} />
        ))}
      </div>
      {workflow ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {workflow.steps.slice(0, 6).map((step) => (
            <span
              key={`${step.step_position}-${step.step_name}-${step.attempt}`}
              className="rounded-[8px] bg-[var(--color-ink-0)] px-2 py-1 text-[11px] text-[var(--color-text-3)]"
              title={`${step.step_name}: ${step.status}`}
            >
              {stepLabel(step.step_name)}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface TimelineItemData {
  key: string;
  icon: string;
  label: string;
  title: string;
  detail: string;
  href: string | null | undefined;
  tone: "ready" | "attention" | "blocked" | "neutral";
}

function TimelineItem({ item }: { item: TimelineItemData }) {
  const content = (
    <span className="flex h-full flex-col rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-3 transition-colors hover:border-[var(--color-line-3)]">
      <span className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-4)]">
          <Icon name={item.icon} size={13} />
          {item.label}
        </span>
        <span
          className={
            "size-2 rounded-full " +
            (item.tone === "ready"
              ? "bg-[var(--color-pos)]"
              : item.tone === "attention"
                ? "bg-[var(--color-warn)]"
                : item.tone === "blocked"
                  ? "bg-[var(--color-neg)]"
                  : "bg-[var(--color-line-3)]")
          }
        />
      </span>
      <span className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-text-1)]">
        {item.title}
      </span>
      <span className="mt-2 line-clamp-3 text-xs leading-5 text-[var(--color-text-3)]">
        {item.detail}
      </span>
    </span>
  );
  if (item.href) {
    const external = item.href.startsWith("http");
    return external ? (
      <a href={item.href} target="_blank" rel="noreferrer" className="min-w-0">
        {content}
      </a>
    ) : (
      <Link href={item.href} prefetch className="min-w-0">
        {content}
      </Link>
    );
  }
  return <div className="min-w-0">{content}</div>;
}

interface MeetingPrepCard {
  meeting_prep_id: string;
  generated_at: string;
  status: "ready" | "blocked";
  next_action: string;
  summary: string;
  thread_summary: string;
  agenda: string[];
  suggested_questions: string[];
  suggested_times: string[];
  availability_status: "included" | "omitted_no_consent";
  source_refs: Array<{ type: string; id: string; label: string; url?: string | null }>;
}

function MeetingPrepPanel({
  conversationId,
  prep,
}: {
  conversationId: string;
  prep: MeetingPrepCard | null;
}) {
  return (
    <div className="section-note">
      <div className="flex items-start gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--color-text-1)]">Meeting prep</p>
          {prep ? (
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
              Updated {new Date(prep.generated_at).toLocaleString()}
            </p>
          ) : null}
        </div>
        <form action={generateMeetingPrepAction} className="ml-auto">
          <input type="hidden" name="return_to" value={agentOutreachDetailHref(conversationId)} />
          <input type="hidden" name="conversation_id" value={conversationId} />
          <PendingSubmitButton
            className="btn-quiet-sm"
            icon="schedule"
            iconSize={14}
            pendingLabel="Preparing"
          >
            Prepare
          </PendingSubmitButton>
        </form>
      </div>
      {prep ? (
        <div className="mt-4 grid gap-3">
          <TraceRow
            label="Next action"
            value={meetingPrepActionLabel(prep.next_action)}
            meta={
              prep.availability_status === "omitted_no_consent"
                ? "Availability omitted until calendar consent exists."
                : prep.suggested_times.join(", ")
            }
          />
          {prep.availability_status === "omitted_no_consent" ? (
            <Link
              href={{
                pathname: "/api/auth/outlook",
                query: {
                  intent: "calendar",
                  return_to: agentOutreachDetailHref(conversationId),
                },
              }}
              prefetch
              className="btn-quiet-sm w-fit"
            >
              <Icon name="event_available" size={14} />
              Connect calendar
            </Link>
          ) : null}
          <TraceRow label="Summary" value={prep.summary} />
          {prep.thread_summary ? (
            <TraceRow label="Thread" value={prep.thread_summary} />
          ) : null}
          {prep.agenda.length ? (
            <TraceRow label="Agenda" value={prep.agenda.join(" · ")} />
          ) : null}
          {prep.suggested_questions.length ? (
            <TraceRow label="Questions" value={prep.suggested_questions.join(" · ")} />
          ) : null}
          {prep.source_refs.length ? (
            <TraceRow
              label="Sources"
              value={prep.source_refs.map((ref) => ref.label).join(" · ")}
            />
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-[var(--color-text-3)]">
          No prep note yet.
        </p>
      )}
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

function PendingApprovalPanel({
  approval,
  conversationId,
}: {
  approval: ConversationTrustApproval;
  conversationId: string;
}) {
  const subject = stringPayload(approval.payload, "subject") ?? "(no subject)";
  const body = stringPayload(approval.payload, "body") ?? "(empty)";
  const returnTo = agentOutreachDetailHref(conversationId);

  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">Review draft</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
        {approval.reason ?? "This outreach is waiting for a human decision."}
      </p>
      <form action={decideApprovalWithDraftAction} className="mt-4 grid gap-3">
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="approval_id" value={approval.id} />
        <input type="hidden" name="decision" value="approved" />
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-3)]">Subject</span>
          <input
            name="subject"
            defaultValue={subject}
            className="min-h-10 rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 text-sm text-[var(--color-text-1)]"
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[var(--color-text-3)]">Body</span>
          <textarea
            name="body"
            rows={8}
            defaultValue={body}
            className="rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)] px-3 py-2 text-sm leading-6 text-[var(--color-text-1)]"
          />
        </label>
        <PendingSubmitButton
          className="btn-solid"
          pendingLabel="Approving"
        >
          Approve
        </PendingSubmitButton>
      </form>
      <form action={decideApprovalWithDraftAction} className="mt-3">
        <input type="hidden" name="return_to" value={returnTo} />
        <input type="hidden" name="approval_id" value={approval.id} />
        <input type="hidden" name="decision" value="rejected" />
        <PendingSubmitButton
          className="btn-quiet w-full"
          pendingLabel="Rejecting"
        >
          Reject
        </PendingSubmitButton>
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

function outcomeLabel(kind: string): string {
  if (kind === "positive_reply") return "Positive reply";
  if (kind === "meeting_booked") return "Meeting booked";
  if (kind === "post_published") return "Post published";
  if (kind === "engagement_lift") return "Lift";
  return kind.replace(/_/g, " ");
}

function strongestGateExplanation(
  gates: ConversationTrustGateExplanation[],
): ConversationTrustGateExplanation | null {
  return (
    gates.find((gate) => gate.severity === "block") ??
    gates.find((gate) => gate.severity === "warn") ??
    gates.find((gate) => gate.kind === "channel") ??
    gates[0] ??
    null
  );
}

function channelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin_dm") return "LinkedIn DM";
  if (channel === "linkedin_connection") return "LinkedIn connection";
  if (channel === "linkedin_inmail") return "LinkedIn InMail";
  return channel.replace(/_/g, " ");
}

function outreachJudgeSummary(
  message: ConversationTrustMessage,
  gate: ConversationTrustGateExplanation | null,
): string {
  const score = message.eval_score ? Number(message.eval_score) : null;
  const judge =
    message.eval_passed === false
      ? "Judge blocked"
      : message.eval_passed === true
        ? "Judge passed"
        : "Judge pending";
  const scoreText = score !== null && Number.isFinite(score)
    ? ` at ${score.toFixed(2)}`
    : "";
  return [judge + scoreText, gate?.summary].filter(Boolean).join(" · ");
}

function stepLabel(stepName: string): string {
  return stepName
    .replace(/^step[:._-]?/i, "")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meetingPrepActionLabel(action: string): string {
  if (action === "prepare_meeting") return "Prepare meeting";
  if (action === "ask_for_times") return "Ask for times";
  if (action === "wait_for_reply") return "Wait for reply";
  if (action === "do_not_follow_up") return "Do not follow up";
  return action.replace(/_/g, " ");
}

function formatWhen(value: Date): string {
  return new Date(value).toLocaleString();
}

function messageDirectionLabel(direction: string): string {
  if (direction === "outbound") return "Agent";
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

export default async function AgentOutreachDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveWorkspaceSessionForDashboard("agent/outreach");
  const workspace = active?.workspace ?? null;
  if (!workspace) {
    return (
      <section className="section-canvas p-6">
        <p className="brief-kicker">Agent</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          No workspace selected.
        </h1>
      </section>
    );
  }
  const loaded = await loadDashboardData<ConversationTrustTraceLoadResult>(
    "agent/outreach",
    "conversation trust trace",
    { status: "unavailable" },
    async () => {
      const trace = await getConversationTrustTrace({
        workspace_id: workspace.id,
        conversation_id: id,
      });
      return trace ? { status: "found", trace } : { status: "missing" };
    },
  );
  if (loaded.status === "missing") return notFound();
  if (loaded.status === "unavailable") return <UnavailableOutreachDetail />;

  const trace = loaded.trace;
  const {
    conversation: conv,
    messages,
    events,
    approvals,
    outcomes,
    gate_explanations: gateExplanations,
    reply_proofs: replyProofs,
    workflow,
  } = trace;
  const pendingApproval =
    approvals.filter((approval) => approval.decision === "pending").at(-1) ?? null;
  const latestPrep = latestMeetingPrep(events);

  return (
    <div className="space-y-6">
      <header className="border-b border-[var(--color-line-1)] pb-5">
        <Link
          href="/dashboard/conversations"
          prefetch
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-3)] hover:text-[var(--color-text-1)]"
        >
          <Icon name="arrow_back" size={14} />
          Conversations
        </Link>
        <p className="mt-5 brief-kicker">Conversation</p>
        <h1 className="mt-2 max-w-3xl text-[32px] font-semibold leading-tight text-[var(--color-text-1)] sm:text-[38px]">
          {conv.counterparty_name ?? "Unknown contact"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-2)]">
          {conv.topic ?? conv.signal_title ?? "Conversation detail and proof of work."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-3)]">
          <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1">
            {conv.status.replace(/_/g, " ")}
          </span>
          {conv.company_name ? (
            <span className="rounded-[8px] bg-[var(--color-ink-2)] px-2.5 py-1">
              {conv.company_name}
            </span>
          ) : null}
        </div>
      </header>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-[var(--color-text-1)]">Messages</h2>
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" />
          ) : (
            <ul className="grid gap-4">
              {messages.map((m) => (
                <li
                  key={m.id}
                  id={`message-${m.id}`}
                  className={
                    "scroll-mt-24 rounded-[14px] border p-4 transition-shadow target:ring-2 target:ring-[var(--color-accent)] target:ring-offset-2 target:ring-offset-[var(--color-ink-1)] " +
                    (m.direction === "outbound"
                      ? "border-[var(--color-line-1)] bg-[var(--color-ink-0)]"
                      : "border-[var(--color-line-2)] bg-[rgba(17,15,11,0.76)]")
                  }
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--color-ink-2)] px-2 py-1 text-xs text-[var(--color-text-3)]">
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
          {pendingApproval ? (
            <PendingApprovalPanel
              approval={pendingApproval}
              conversationId={conv.id}
            />
          ) : null}

          <MeetingPrepPanel conversationId={conv.id} prep={latestPrep} />

          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Contact</p>
            <p className="mt-1 font-sans text-sm text-[var(--color-text-1)]">
              {conv.counterparty_name}
            </p>
            {conv.counterparty_title ? (
              <p className="mt-0.5 font-sans text-xs text-[var(--color-text-2)]">
                {conv.counterparty_title}
              </p>
            ) : null}
            {conv.company_name ? (
              <p className="mt-0.5 font-sans text-xs text-[var(--color-text-2)]">
                {conv.company_name}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <TrustPill
                ready={conv.counterparty_email_status === "verified"}
                icon="mail"
              >
                {contactEmailStatusLabel(conv.counterparty_email_status)}
              </TrustPill>
              <TrustPill
                ready={conv.counterparty_linkedin_ready === true}
                icon="linkedin"
              >
                {conv.counterparty_linkedin_ready ? "LinkedIn profile" : "No LinkedIn profile"}
              </TrustPill>
              {conv.counterparty_fit_decision ? (
                <TrustPill
                  ready={conv.counterparty_fit_decision === "fit"}
                  icon="fact_check"
                >
                  {contactFitLabel(conv.counterparty_fit_decision)}
                </TrustPill>
              ) : null}
            </div>
            <div className="mt-4 grid gap-2 border-t border-[var(--color-line-1)] pt-4">
              <ContactHandle
                label="Email"
                value={conv.counterparty_emails?.[0] ?? "Missing"}
              />
              <ContactHandle
                label="LinkedIn"
                value={conv.counterparty_linkedin_url ?? "Missing"}
                href={conv.counterparty_linkedin_url}
              />
            </div>
            {conv.rep_name ? (
              <p className="mt-3 text-xs text-[var(--color-text-3)]">
                Voice <span className="text-[var(--color-text-1)]">{conv.rep_name}</span>
              </p>
            ) : null}
            {conv.signal_title ? (
              <div className="mt-4 border-t border-[var(--color-line-1)] pt-4">
                <p className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-4)]">
                  Why now
                </p>
                <p className="mt-1 font-sans text-sm leading-5 text-[var(--color-text-1)]">
                {conv.signal_title}
                </p>
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <details className="group rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-0)]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--color-text-2)]">
          <Icon name="account_tree" size={15} />
          Delivery and workflow proof
          <Icon
            name="expand_more"
            size={16}
            className="ml-auto transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="border-t border-[var(--color-line-1)] p-3 sm:p-4">
          <OutreachProofTimeline
            conversation={conv}
            messages={messages}
            outcomes={outcomes}
            replyProofs={replyProofs}
            gateExplanations={gateExplanations}
            workflow={workflow}
          />
        </div>
      </details>
    </div>
  );
}

function UnavailableOutreachDetail() {
  return (
    <div className="space-y-6">
      <section className="section-canvas p-6">
        <p className="brief-kicker">Agent</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          Outreach temporarily unavailable.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-2)]">
          We could not load this conversation trace just now.
        </p>
      </section>
      <EmptyState
        title="Try again in a moment."
        hint="Messages, approvals, channel evidence, and meeting prep will return after the workspace reconnects."
      />
    </div>
  );
}

function agentOutreachDetailHref(conversationId: string): string {
  return `/dashboard/conversations/${conversationId}`;
}

function TrustPill({
  ready,
  icon,
  children,
}: {
  ready: boolean;
  icon: string;
  children: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-xs " +
        (ready
          ? "bg-[var(--color-pos-bg)] text-[var(--color-pos)]"
          : "bg-[var(--color-ink-2)] text-[var(--color-text-2)]")
      }
    >
      <Icon name={icon} size={13} />
      {children}
    </span>
  );
}

function ContactHandle({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string | null;
}) {
  return (
    <p className="min-w-0 text-xs leading-5 text-[var(--color-text-3)]">
      <span className="block text-[11px] uppercase tracking-[0.08em] text-[var(--color-text-4)]">
        {label}
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-[var(--color-text-1)] hover:text-[var(--color-accent)]"
        >
          {value}
        </a>
      ) : (
        <span className="block truncate text-[var(--color-text-1)]">{value}</span>
      )}
    </p>
  );
}

function contactEmailStatusLabel(status: string | null): string {
  if (status === "verified") return "Verified email";
  if (status === "invalid") return "Email invalid";
  if (status === "found") return "Email found";
  return "Email pending";
}

function contactFitLabel(decision: string): string {
  if (decision === "fit") return "Good fit";
  if (decision === "not_fit") return "Not fit";
  if (decision === "unsure") return "Needs fit review";
  return decision.replace(/_/g, " ");
}

function latestMeetingPrep(events: ConversationTrustEvent[]): MeetingPrepCard | null {
  const event = events
    .filter((item) => item.event_type === "meeting.prep.generated")
    .at(-1);
  return event ? parseMeetingPrep(event.payload) : null;
}

function parseMeetingPrep(payload: Record<string, unknown>): MeetingPrepCard | null {
  const meeting_prep_id = textValue(payload.meeting_prep_id);
  const generated_at = textValue(payload.generated_at);
  const summary = textValue(payload.summary);
  if (!meeting_prep_id || !generated_at || !summary) return null;
  return {
    meeting_prep_id,
    generated_at,
    status: payload.status === "blocked" ? "blocked" : "ready",
    next_action: textValue(payload.next_action) ?? "wait_for_reply",
    summary,
    thread_summary: textValue(payload.thread_summary) ?? "",
    agenda: stringArray(payload.agenda),
    suggested_questions: stringArray(payload.suggested_questions),
    suggested_times: stringArray(payload.suggested_times),
    availability_status:
      payload.availability_status === "included" ? "included" : "omitted_no_consent",
    source_refs: Array.isArray(payload.source_refs)
      ? payload.source_refs.map(parseSourceRef).filter(isSourceRef)
      : [],
  };
}

function parseSourceRef(value: unknown): MeetingPrepCard["source_refs"][number] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = textValue(record.id);
  const label = textValue(record.label);
  if (!id || !label) return null;
  return {
    type: textValue(record.type) ?? "conversation",
    id,
    label,
    url: textValue(record.url),
  };
}

function isSourceRef(
  value: MeetingPrepCard["source_refs"][number] | null,
): value is MeetingPrepCard["source_refs"][number] {
  return value != null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}
