import { notFound } from "next/navigation";
import Link from "next/link";
import { EmptyState, SectionHeader } from "@/components/dashboard/Shell";
import { getPool } from "@/core/substrate/storage/index.ts";
import { getActiveWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

interface ConversationDetail {
  id: string;
  status: string;
  topic: string | null;
  started_at: Date;
  last_activity_at: Date;
  counterparty_name: string | null;
  counterparty_emails: string[] | null;
  company_name: string | null;
  rep_name: string | null;
  rep_id: string | null;
  signal_id: string | null;
  signal_title: string | null;
  signal_kind: string | null;
}

interface MessageRow {
  id: string;
  channel: string;
  direction: string;
  status: string;
  subject: string | null;
  body: string | null;
  external_id: string | null;
  eval_score: string | null;
  eval_passed: boolean | null;
  intent_class: string | null;
  intent_confidence: string | null;
  sent_at: Date | null;
  created_at: Date;
  provenance: Record<string, unknown> | null;
  eval_notes: Record<string, unknown> | null;
}

interface EventRow {
  id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

interface WorkflowRunRow {
  id: string;
  workflow_name: string;
  workflow_version: string;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
}

interface StepRow {
  step_name: string;
  step_position: number;
  attempt: number;
  status: string;
  started_at: Date | null;
  ended_at: Date | null;
}

async function loadConversation(
  workspaceId: string,
  id: string,
): Promise<ConversationDetail | null> {
  const pool = getPool();
  const { rows } = await pool.query<ConversationDetail>(
    `select c.id, c.status::text as status, c.topic, c.started_at, c.last_activity_at,
            p.full_name as counterparty_name,
            p.emails::text[] as counterparty_emails,
            co.name as company_name,
            r.name as rep_name,
            r.id as rep_id,
            s.id as signal_id,
            s.title as signal_title,
            s.kind::text as signal_kind
       from conversations c
       left join graph_persons p on p.id = c.counterparty_person_id
       left join graph_companies co on co.id = c.counterparty_company_id
       left join reps r on r.id = c.rep_id
       left join signals s on s.id = c.origin_signal_id
      where c.workspace_id = $1 and c.id = $2`,
    [workspaceId, id],
  );
  return rows[0] ?? null;
}

async function loadMessages(workspaceId: string, conversationId: string): Promise<MessageRow[]> {
  const pool = getPool();
  const { rows } = await pool.query<MessageRow>(
    `select id, channel::text as channel, direction::text as direction, status::text as status,
            subject, body, external_id,
            eval_score::text as eval_score, eval_passed,
            intent_class, intent_confidence::text as intent_confidence,
            sent_at, created_at, provenance, eval_notes
       from messages
      where workspace_id = $1 and conversation_id = $2
      order by coalesce(sent_at, created_at) asc`,
    [workspaceId, conversationId],
  );
  return rows;
}

async function loadEvents(workspaceId: string, conversationId: string): Promise<EventRow[]> {
  const pool = getPool();
  // Use two parameter slots so each comparison gets its own type:
  // correlation_id is uuid; payload->>... returns text.
  const { rows } = await pool.query<EventRow>(
    `select id, event_type, source, payload, occurred_at
       from events
      where workspace_id = $1
        and (
          correlation_id = $2::uuid
          or payload->>'conversation_id' = $3
        )
      order by occurred_at asc
      limit 200`,
    [workspaceId, conversationId, conversationId],
  );
  return rows;
}

async function loadWorkflowRunForSignal(
  workspaceId: string,
  signalId: string | null,
): Promise<{ run: WorkflowRunRow; steps: StepRow[] } | null> {
  if (!signalId) return null;
  const pool = getPool();
  const { rows: runs } = await pool.query<WorkflowRunRow>(
    `select wr.id, wr.workflow_name, wr.workflow_version, wr.status::text as status,
            wr.started_at, wr.ended_at
       from workflow_runs wr
      where wr.workspace_id = $1
        and wr.input::jsonb->>'signal_id' = $2
      order by wr.created_at desc
      limit 1`,
    [workspaceId, signalId],
  );
  const run = runs[0];
  if (!run) return null;
  const { rows: steps } = await pool.query<StepRow>(
    `select step_name, step_position, attempt, status::text as status, started_at, ended_at
       from workflow_steps where run_id = $1
      order by step_position asc, attempt asc`,
    [run.id],
  );
  return { run, steps };
}

function preview(body: string | null, max = 600): string {
  if (!body) return "(empty)";
  return body.length > max ? body.slice(0, max) + "…" : body;
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
      <>
        <SectionHeader eyebrow="conversation" title="No workspace selected" />
      </>
    );
  }
  const conv = await loadConversation(workspace.id, id);
  if (!conv) return notFound();

  const [messages, events, workflow] = await Promise.all([
    loadMessages(workspace.id, conv.id),
    loadEvents(workspace.id, conv.id),
    loadWorkflowRunForSignal(workspace.id, conv.signal_id),
  ]);

  return (
    <>
      <SectionHeader
        eyebrow="conversation"
        title={conv.counterparty_name ?? "(unknown counterparty)"}
        subtitle={conv.topic ?? conv.signal_title ?? ""}
      />

      <div className="grid grid-cols-[1fr_320px] gap-8">
        <section>
          <h2 className="font-serif text-xl text-[var(--color-text-1)] mb-3">
            Messages
          </h2>
          {messages.length === 0 ? (
            <EmptyState title="No messages yet" />
          ) : (
            <ul className="space-y-4">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={
                    "rounded-lg p-4 border " +
                    (m.direction === "outbound"
                      ? "border-[var(--color-line-1)] bg-[var(--color-ink-0)]"
                      : "border-[var(--color-line-2)] bg-[var(--color-ink-2)]")
                  }
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)]">
                      {m.direction} · {m.channel}
                    </span>
                    <span
                      className={
                        "font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded " +
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
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded bg-[var(--color-ink-3)] text-[var(--color-text-2)]">
                        intent · {m.intent_class}
                        {m.intent_confidence
                          ? ` (${Number(m.intent_confidence).toFixed(2)})`
                          : ""}
                      </span>
                    ) : null}
                    {m.eval_score ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] px-2 py-0.5 rounded bg-[var(--color-ink-3)] text-[var(--color-text-2)]">
                        eval {Number(m.eval_score).toFixed(2)}
                        {m.eval_passed === false ? " · failed" : ""}
                      </span>
                    ) : null}
                    <span className="ml-auto font-mono text-xs text-[var(--color-text-3)]">
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

        <aside className="space-y-6">
          <div className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
              counterparty
            </p>
            <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
              {conv.counterparty_name}
            </p>
            {conv.company_name ? (
              <p className="font-sans text-xs text-[var(--color-text-2)] mt-0.5">
                {conv.company_name}
              </p>
            ) : null}
            {conv.counterparty_emails?.[0] ? (
              <p className="font-mono text-xs text-[var(--color-text-3)] mt-1">
                {conv.counterparty_emails[0]}
              </p>
            ) : null}
            {conv.rep_name ? (
              <p className="font-mono text-xs text-[var(--color-text-3)] mt-3">
                rep: <span className="text-[var(--color-text-1)]">{conv.rep_name}</span>
              </p>
            ) : null}
          </div>

          {conv.signal_title ? (
            <div className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                origin signal
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] mt-1">
                {conv.signal_kind}
              </p>
              <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
                {conv.signal_title}
              </p>
            </div>
          ) : null}

          {workflow ? (
            <div className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
                show your work
              </p>
              <p className="font-sans text-sm text-[var(--color-text-1)] mt-1">
                {workflow.run.workflow_name}{" "}
                <span className="font-mono text-xs text-[var(--color-text-3)]">
                  v{workflow.run.workflow_version}
                </span>
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-text-3)] mt-0.5">
                {workflow.run.status}
              </p>
              <ol className="mt-3 space-y-1">
                {workflow.steps.map((s) => (
                  <li
                    key={`${s.step_position}-${s.attempt}`}
                    className="flex items-center gap-2 font-mono text-xs text-[var(--color-text-2)]"
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

          <div className="border border-[var(--color-line-1)] rounded-lg p-4 bg-[var(--color-ink-0)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
              event trace
            </p>
            <ol className="mt-2 space-y-1 max-h-80 overflow-auto">
              {events.map((e) => (
                <li key={e.id} className="font-mono text-[10px] text-[var(--color-text-2)]">
                  <span className="text-[var(--color-text-3)]">
                    {new Date(e.occurred_at).toLocaleTimeString()}
                  </span>{" "}
                  <span className="text-[var(--color-text-1)]">{e.event_type}</span>
                </li>
              ))}
              {events.length === 0 ? (
                <li className="font-mono text-xs text-[var(--color-text-3)]">
                  (no events yet)
                </li>
              ) : null}
            </ol>
          </div>

          <p className="font-mono text-xs text-[var(--color-text-3)]">
            <Link
              href="/dashboard/conversations"
              className="hover:text-[var(--color-text-1)]"
            >
              ← back to conversations
            </Link>
          </p>
        </aside>
      </div>
    </>
  );
}
