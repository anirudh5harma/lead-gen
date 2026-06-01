import { notFound } from "next/navigation";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/Shell";
import {
  getConversationTrustTrace,
  type ConversationTrustApproval,
  type ConversationTrustConversation,
  type ConversationTrustEvent,
  type ConversationTrustMessage,
  type ConversationTrustOutcome,
  type ConversationTrustStep,
  type ConversationTrustWorkflowRun,
} from "@/core/product/conversation-trust";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function preview(body: string | null, max = 600): string {
  if (!body) return "(empty)";
  return body.length > max ? body.slice(0, max) + "…" : body;
}

function TrustTracePanel({
  conversation,
  messages,
  workflow,
  approvals,
  outcomes,
  events,
}: {
  conversation: ConversationTrustConversation;
  messages: ConversationTrustMessage[];
  workflow: {
    run: ConversationTrustWorkflowRun;
    steps: ConversationTrustStep[];
  } | null;
  approvals: ConversationTrustApproval[];
  outcomes: ConversationTrustOutcome[];
  events: ConversationTrustEvent[];
}) {
  const outbound =
    [...messages].reverse().find((message) => message.direction === "outbound") ??
    messages[0] ??
    null;
  const latestApproval = approvals.at(-1) ?? null;
  const latestOutcome = outcomes.at(-1) ?? null;
  const sendEvent = outbound
    ? [...events]
        .reverse()
        .find(
          (event) =>
            ["message.sent", "message.deferred", "message.delivered", "message.bounced"].includes(
              event.event_type,
            ) && event.payload?.message_id === outbound.id,
        )
    : null;
  const researchStep = workflow?.steps.find(
    (step) => step.step_name === "research.signal_context",
  );
  const contextStep = workflow?.steps.find(
    (step) => step.step_name === "context.workspace_agent",
  );
  const patternKey = textValue(outbound?.provenance?.pattern_key);
  const exemplarCount = Array.isArray(outbound?.provenance?.exemplar_ids)
    ? outbound.provenance.exemplar_ids.length
    : 0;
  const critique =
    textValue(outbound?.eval_notes?.critique) ??
    textValue(outbound?.eval_notes?.draft_rejection_reason);
  const deferReason =
    textValue(outbound?.properties?.defer_reason) ??
    textValue(outbound?.eval_notes?.defer_reason) ??
    textValue(sendEvent?.payload?.defer_reason);

  return (
    <div className="section-note">
      <p className="text-sm font-semibold text-[var(--color-text-1)]">Trust trace</p>
      <p className="mt-1 text-xs leading-5 text-[var(--color-text-3)]">
        Why this happened, what checked it, and what came back.
      </p>
      <div className="mt-4 grid gap-3">
        <TraceRow
          label="Signal"
          value={conversation.signal_title ?? conversation.topic ?? "No signal anchor"}
          meta={conversation.signal_kind ?? undefined}
        />
        <TraceRow
          label="Context"
          value={
            patternKey
              ? `${patternKey}${exemplarCount ? ` · ${exemplarCount} exemplar${exemplarCount === 1 ? "" : "s"}` : ""}`
              : researchStep
                ? `Research step ${researchStep.status}`
                : "No retrieved context recorded"
          }
          meta={contextStep ? `workspace context ${contextStep.status}` : undefined}
        />
        <TraceRow
          label="Judge"
          value={
            outbound?.eval_score
              ? `${Number(outbound.eval_score).toFixed(2)} · ${
                  outbound.eval_passed ? "passed" : "blocked"
                }`
              : "No judge result yet"
          }
          meta={critique ?? undefined}
        />
        <TraceRow
          label="Approval"
          value={
            latestApproval
              ? `${latestApproval.decision} · ${latestApproval.kind}`
              : "No approval gate requested"
          }
          meta={latestApproval?.reason ?? undefined}
        />
        <TraceRow
          label="Channel"
          value={
            outbound
              ? `${outbound.status}${deferReason ? ` · ${deferReason}` : ""}`
              : "No channel attempt yet"
          }
          meta={sendEvent ? sendEvent.event_type : undefined}
        />
        <TraceRow
          label="Outcome"
          value={
            latestOutcome
              ? `${latestOutcome.kind.replace(/_/g, " ")} · ${Number(latestOutcome.score).toFixed(2)}`
              : "No outcome recorded yet"
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

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatWhen(value: Date): string {
  return new Date(value).toLocaleString();
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
  const { conversation: conv, messages, events, workflow, approvals, outcomes } = trace;

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
                      {m.direction}. {m.channel}
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
                      {m.status}
                    </span>
                    {m.intent_class ? (
                      <span className="rounded-full bg-[var(--color-ink-3)] px-2 py-1 text-xs text-[var(--color-text-2)]">
                        reply. {m.intent_class}
                        {m.intent_confidence
                          ? ` (${Number(m.intent_confidence).toFixed(2)})`
                          : ""}
                      </span>
                    ) : null}
                    {m.eval_score ? (
                      <span className="rounded-full bg-[var(--color-ink-3)] px-2 py-1 text-xs text-[var(--color-text-2)]">
                        quality {Number(m.eval_score).toFixed(2)}
                        {m.eval_passed === false ? ". needs review" : ""}
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
          <TrustTracePanel
            conversation={conv}
            messages={messages}
            workflow={workflow}
            approvals={approvals}
            outcomes={outcomes}
            events={events}
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
              <p className="mt-1 text-xs text-[var(--color-text-3)]">
                {conv.signal_kind}
              </p>
              <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
                {conv.signal_title}
              </p>
            </div>
          ) : null}

          {workflow ? (
            <div className="section-note">
              <p className="text-sm font-semibold text-[var(--color-text-1)]">Work path</p>
              <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
                Outreach flow
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-3)]">
                {workflow.run.status}
              </p>
              <ol className="mt-3 space-y-1">
                {workflow.steps.map((s) => (
                  <li
                    key={`${s.step_position}-${s.attempt}`}
                    className="flex items-center gap-2 text-xs text-[var(--color-text-2)]"
                  >
                    <span
                      className={
                        "inline-block w-1.5 h-1.5 rounded-full " +
                        (s.status === "completed"
                          ? "bg-[var(--color-pos)]"
                          : s.status === "failed"
                            ? "bg-[var(--color-neg)]"
                            : "bg-[var(--color-warn)]")
                      }
                    />
                    <span className="flex-1">{s.step_name}</span>
                    {s.attempt > 1 ? (
                      <span className="text-[var(--color-text-3)]">
                        attempt {s.attempt}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Proof trail</p>
            <ol className="mt-2 space-y-1 max-h-80 overflow-auto">
              {events.map((e) => (
                <li key={e.id} className="text-xs text-[var(--color-text-2)]">
                  <span className="text-[var(--color-text-3)]">
                    {new Date(e.occurred_at).toLocaleTimeString()}
                  </span>{" "}
                  <span className="text-[var(--color-text-1)]">{e.event_type}</span>
                </li>
              ))}
              {events.length === 0 ? (
                <li className="text-xs text-[var(--color-text-3)]">
                  (no events yet)
                </li>
              ) : null}
            </ol>
          </div>

          <p className="text-xs text-[var(--color-text-3)]">
            <Link
              href="/dashboard/conversations"
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
