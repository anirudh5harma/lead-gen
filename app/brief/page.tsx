import Icon from "@/components/Icon";
import { runFirstVerticalSlice } from "@/core/plays";
import { getAppState, hasDatabase } from "@/core/product/app";
import { LiveIndicator } from "./live-indicator";
import { getBriefWorkspaceSession } from "./session";
import {
  bootstrapAction,
  configureEmailAction,
  configureRssSourceAction,
  decideApprovalAction,
  pollSourcesAction,
  provisionSendingDomainAction,
  refreshSendingDomainAction,
  retryWorkflowAction,
  submitSignalAction,
  verifySendingDomainAction,
} from "./actions";

export const dynamic = "force-dynamic";

const eventLabels: Record<string, string> = {
  "signal.ingested": "Signal",
  "play.run.started": "Play",
  "conversation.opened": "Conversation",
  "draft.proposed": "Draft",
  "draft.judged": "Judge",
  "message.queued": "Queued",
  "message.sent": "Sent",
  "message.deferred": "Deferred",
  "approval.requested": "Approval",
  "approval.decided": "Decision",
  "outcome.recorded": "Outcome",
  "rep.memory.procedural.updated": "Memory",
  "play.run.completed": "Done",
  "workflow.step.failed": "Step Failed",
  "workflow.run.failed": "Run Failed",
  "workflow.run.retried": "Retry",
  "channel.domain.provisioned": "Domain",
  "channel.domain.verification.requested": "Verify",
  "channel.domain.status.received": "DNS",
  "channel.domain.dmarc.observed": "DMARC",
  "channel.domain.trust.verified": "Trust",
  "channel.domain.warmup.advanced": "Warmup",
};

export default async function BriefPage() {
  if (!hasDatabase()) {
    const result = await runFirstVerticalSlice();
    return <DemoBrief result={result} />;
  }

  const session = await getBriefWorkspaceSession();
  if (!session) {
    return <UnconfiguredBrief />;
  }

  const state = await getAppState(undefined, session);
  const latestMessage = state.messages[0];
  const latestOutcome = state.outcomes[0];
  const latestRun = state.runs[0];
  const latestTrace = state.sendTraces[0];
  const latestVoiceScore = latestTrace ? axisScore(latestTrace.eval_notes, "brand_voice") : null;
  const pendingApprovals = state.approvals.filter((a) => a.decision === "pending");
  const channel = state.channelAccounts[0];
  const latestDeferReason =
    latestMessage?.properties &&
    typeof latestMessage.properties.defer_reason === "string"
      ? latestMessage.properties.defer_reason
      : "-";

  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-[var(--color-line-1)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
              Morning brief
            </p>
            <h1 className="mt-2 font-serif text-4xl leading-tight text-[var(--color-text-1)]">
              Persisted GTM run inspector
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveIndicator enabled={state.configured} />
            <form action={bootstrapAction}>
              <button className="inline-flex items-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-0)]">
                <Icon name="database" size={18} />
                Bootstrap Workspace
              </button>
            </form>
          </div>
        </header>

        {!state.configured ? (
          <NoWorkspacePanel />
        ) : (
          <>
            <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <Panel title="Manual Signal">
                <form action={submitSignalAction} className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field name="company_name" label="Company" defaultValue="Acme Payroll" />
                    <Field name="company_domain" label="Domain" defaultValue="acmepayroll.example" />
                    <Field name="person_name" label="Person" defaultValue="Nisha Rao" />
                    <Field name="person_email" label="Email" defaultValue="nisha@acmepayroll.example" />
                  </div>
                  <Field
                    name="signal_title"
                    label="Signal"
                    defaultValue="Acme Payroll announced a Series A"
                  />
                  <label className="grid gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                      Context
                    </span>
                    <textarea
                      name="signal_content"
                      defaultValue="Acme Payroll raised a Series A to expand finance workflows for distributed teams."
                      className="min-h-24 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 text-sm"
                    />
                  </label>
                  <Field name="signal_url" label="Source URL" defaultValue="https://example.com/acme-series-a" />
                  <label className="grid gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                      Approval
                    </span>
                    <select
                      name="approval"
                      defaultValue="always"
                      className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 text-sm"
                    >
                      <option value="always">Require approval</option>
                      <option value="none">Send after judge</option>
                    </select>
                  </label>
                  <button className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white">
                    <Icon name="bolt" size={18} />
                    Ingest Signal
                  </button>
                </form>
              </Panel>

              <Panel title="Email Channel">
                <form action={configureEmailAction} className="grid gap-3">
                  <Field
                    name="display_name"
                    label="Sender"
                    defaultValue={channel?.display_name ?? "maya@go.bombsell.example"}
                  />
                  <Field
                    name="daily_cap"
                    label="Daily Cap"
                    defaultValue={String(channel?.daily_cap ?? 25)}
                  />
                  <button className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-0)]">
                    <Icon name="save" size={18} />
                    Save Channel
                  </button>
                </form>

                <div className="mt-6 grid grid-cols-3 gap-4">
                  <Metric label="Run" value={latestRun?.status ?? "-"} />
                  <Metric label="Message" value={latestMessage?.status ?? "-"} />
                  <Metric label="Outcome" value={latestOutcome?.kind ?? "-"} />
                </div>
                <div className="mt-6 border-t border-[var(--color-line-1)] pt-4">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                    Model Budget
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3">
                    <Metric
                      label="Tokens"
                      value={`${state.llmUsage.used_tokens_24h}/${state.llmUsage.daily_token_cap}`}
                    />
                    <Metric
                      label="Mode"
                      value={
                        state.llmUsage.used_tokens_24h >= state.llmUsage.daily_token_cap
                          ? "degraded"
                          : "normal"
                      }
                    />
                    <Metric label="Window" value="24h" />
                  </div>
                </div>
                <div className="mt-6 border-t border-[var(--color-line-1)] pt-4">
                  <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                    Deliverability
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
                    <Metric
                      label="Volume"
                      value={`${channel?.daily_used ?? 0}/${channel?.daily_cap ?? 0}`}
                    />
                    <Metric label="Domain" value={channel?.domain ?? "-"} />
                    <Metric label="Warmup" value={channel?.warmup_state ?? "-"} />
                    <Metric label="Domain Cap" value={String(channel?.current_daily_cap ?? 0)} />
                    <Metric label="Defer" value={latestDeferReason} />
                    <Metric label="Provider" value={channel?.provider_status ?? "-"} />
                    <Metric label="SPF" value={verificationValue(channel?.spf_verified)} />
                    <Metric label="DKIM" value={verificationValue(channel?.dkim_verified)} />
                    <Metric label="DMARC" value={verificationValue(channel?.dmarc_verified)} />
                  </div>
                  {channel?.domain && channel.warmup_state !== "warmed" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {!channel.provider_domain_id ? (
                        <form action={provisionSendingDomainAction}>
                          <button className="inline-flex items-center gap-2 rounded-md bg-[var(--color-text-1)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-0)]">
                            <Icon name="dns" size={17} />
                            Provision Domain
                          </button>
                        </form>
                      ) : (
                        <>
                          <form action={verifySendingDomainAction}>
                            <button className="inline-flex items-center gap-2 rounded-md bg-[var(--color-text-1)] px-3 py-2 text-sm font-semibold text-[var(--color-ink-0)]">
                              <Icon name="verified" size={17} />
                              Verify DNS
                            </button>
                          </form>
                          <form action={refreshSendingDomainAction}>
                            <button className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line-1)] px-3 py-2 text-sm font-semibold text-[var(--color-text-1)]">
                              <Icon name="sync" size={17} />
                              Refresh
                            </button>
                          </form>
                        </>
                      )}
                    </div>
                  ) : null}
                  {channel?.dns_records.length ? (
                    <div className="mt-4 grid gap-2">
                      {channel.dns_records.map((record) => (
                        <div
                          key={`${record.record}:${record.name}`}
                          className="grid gap-1 rounded-md border border-[var(--color-line-1)] px-3 py-2 text-xs md:grid-cols-[72px_1fr_1.6fr_90px] md:items-center"
                        >
                          <span className="font-mono text-[var(--color-text-3)]">{record.record}</span>
                          <span className="truncate">{record.name}</span>
                          <span className="truncate font-mono text-[var(--color-text-2)]">{record.value}</span>
                          <span className="text-[var(--color-text-3)]">{record.status ?? "pending"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Panel>
            </section>

            <Panel title="Signal Sources">
              <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
                <div className="grid gap-3">
                  <form action={configureRssSourceAction} className="grid gap-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field name="name" label="Source" defaultValue="GTM Signals" />
                      <Field
                        name="poll_interval_minutes"
                        label="Poll Minutes"
                        defaultValue="15"
                      />
                    </div>
                    <Field
                      name="url"
                      label="Feed URL"
                      defaultValue="https://example.com/feed.xml"
                      type="url"
                    />
                    <label className="grid gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
                        Signal Kind
                      </span>
                      <select
                        name="signal_kind"
                        defaultValue="press_mention"
                        className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 text-sm"
                      >
                        <option value="press_mention">Press mention</option>
                        <option value="funding">Funding</option>
                        <option value="hiring">Hiring</option>
                        <option value="product_launch">Product launch</option>
                        <option value="competitor_move">Competitor move</option>
                        <option value="podcast_mention">Podcast mention</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <button className="inline-flex items-center justify-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-0)]">
                      <Icon name="rss_feed" size={18} />
                      Save Source
                    </button>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <form action={pollSourcesAction}>
                      <button className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--color-line-1)] px-4 py-2 text-sm font-semibold">
                        <Icon name="sync" size={18} />
                        Poll Due
                      </button>
                    </form>
                  </div>
                </div>

                {state.sources.length === 0 ? (
                  <div className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4 text-sm text-[var(--color-text-2)]">
                    No RSS sources configured.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {state.sources.map((source) => (
                      <div
                        key={source.id}
                        className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--color-text-1)]">
                              {source.name}
                            </p>
                            <p className="mt-1 truncate font-mono text-xs text-[var(--color-text-3)]">
                              {source.url ?? "-"}
                            </p>
                          </div>
                          <span className="inline-flex w-fit items-center gap-1 rounded-md border border-[var(--color-line-1)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-3)]">
                            <Icon
                              name={source.enabled ? "radio_button_checked" : "radio_button_unchecked"}
                              size={14}
                            />
                            {source.enabled ? "Enabled" : "Paused"}
                          </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
                          <Metric label="Kind" value={source.signal_kind ?? source.kind} />
                          <Metric label="Signals" value={String(source.signal_count)} />
                          <Metric
                            label="Poll"
                            value={
                              source.poll_interval_minutes == null
                                ? "-"
                                : `${source.poll_interval_minutes}m`
                            }
                          />
                          <Metric
                            label="Last"
                            value={formatTime(source.last_polled_at)}
                          />
                          <Metric
                            label="Run"
                            value={source.latest_run_status ?? "-"}
                          />
                        </div>
                        {source.latest_run_error ? (
                          <p className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2 text-xs text-[var(--color-text-2)]">
                            {source.latest_run_error}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Panel>

            <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <Panel title="Run Trace">
                <div className="mb-4 grid grid-cols-2 gap-4 border-b border-[var(--color-line-1)] pb-4 md:grid-cols-4">
                  <Metric
                    label="Events"
                    value={String(state.eventTrace.summary.event_count)}
                  />
                  <Metric
                    label="Root"
                    value={eventLabel(state.eventTrace.summary.root_event_type)}
                  />
                  <Metric
                    label="Terminal"
                    value={eventLabel(state.eventTrace.summary.terminal_event_type)}
                  />
                  <Metric
                    label="Trace"
                    value={state.eventTrace.summary.correlation_id?.slice(0, 8) ?? "-"}
                  />
                </div>
                <ol className="grid gap-3">
                  {(state.eventTrace.events.length > 0
                    ? state.eventTrace.events
                    : state.events.slice().reverse())
                    .filter((event) => event.event_type in eventLabels)
                    .map((event, index) => (
                      <li
                        key={event.id}
                        className="grid grid-cols-[32px_1fr] items-start gap-3"
                      >
                        <span className="flex size-8 items-center justify-center rounded-full border border-[var(--color-line-1)] bg-[var(--color-ink-2)] font-mono text-xs text-[var(--color-text-2)]">
                          {index + 1}
                        </span>
                        <div className="border-b border-[var(--color-line-1)] pb-3">
                          <p className="text-sm font-medium text-[var(--color-text-1)]">
                            {eventLabels[event.event_type]}
                          </p>
                          <p className="font-mono text-xs text-[var(--color-text-3)]">
                            {event.event_type}
                          </p>
                          {eventMeta(event) ? (
                            <p className="mt-1 font-mono text-[11px] text-[var(--color-text-3)]">
                              {eventMeta(event)}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                </ol>
              </Panel>

              <div className="grid gap-6">
                <Panel title="Recovery Queue">
                  {state.recoveryQueue.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-2)]">No failed workflows.</p>
                  ) : (
                    <div className="grid gap-3">
                      {state.recoveryQueue.map((run) => (
                        <div
                          key={run.id}
                          className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3"
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">
                                {workflowLabel(run.workflow_name)}
                              </p>
                              <p className="mt-1 font-mono text-xs text-[var(--color-text-3)]">
                                {run.failed_step_name ?? "workflow"} · {formatTime(run.ended_at)}
                              </p>
                            </div>
                            <RetryWorkflowForm id={run.id} />
                          </div>
                          {run.error ? (
                            <p className="mt-3 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-3 py-2 text-xs text-[var(--color-text-2)]">
                              {run.error}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel title="Approvals">
                  {pendingApprovals.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-2)]">No pending approvals.</p>
                  ) : (
                    <div className="grid gap-3">
                      {pendingApprovals.map((approval) => (
                        <div
                          key={approval.id}
                          className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-3"
                        >
                          <p className="text-sm font-semibold">{approval.reason}</p>
                          <p className="mt-1 font-mono text-xs text-[var(--color-text-3)]">
                            {approval.kind}
                          </p>
                          <div className="mt-3 flex gap-2">
                            <DecisionForm id={approval.id} decision="approved" label="Approve" />
                            <DecisionForm id={approval.id} decision="rejected" label="Reject" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                <Panel title="Draft And Outcome">
                  {latestTrace ? (
                    <div className="mb-4 rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
                      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                        <Metric label="Rep" value={latestTrace.rep_name ?? "-"} />
                        <Metric label="Signal" value={latestTrace.signal_kind ?? "-"} />
                        <Metric
                          label="Judge"
                          value={formatScore(latestTrace.eval_score)}
                        />
                        <Metric
                          label="Voice"
                          value={formatScore(latestVoiceScore)}
                        />
                        <Metric
                          label="Gate"
                          value={latestTrace.defer_reason ?? latestTrace.approval_policy ?? "-"}
                        />
                      </div>
                      <div className="mt-4 grid gap-3 border-t border-[var(--color-line-1)] pt-4 text-sm text-[var(--color-text-2)]">
                        <TraceLine label="Person" value={latestTrace.person_name ?? "-"} />
                        <TraceLine label="Company" value={latestTrace.company_name ?? "-"} />
                        <TraceLine label="Signal" value={latestTrace.signal_title ?? "-"} />
                        <TraceLine label="Pattern" value={latestTrace.pattern_key ?? "-"} />
                        <TraceLine
                          label="Workflow"
                          value={
                            latestTrace.workflow_run_id
                              ? `${latestTrace.workflow_status ?? "-"} · ${latestTrace.workflow_run_id.slice(0, 8)}`
                              : "-"
                          }
                        />
                      </div>
                    </div>
                  ) : null}
                  {latestMessage ? (
                    <div className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4">
                      <p className="text-sm font-semibold text-[var(--color-text-1)]">
                        {latestMessage.subject}
                      </p>
                      <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-[var(--color-text-2)]">
                        {latestMessage.body}
                      </pre>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-text-2)]">
                      Submit a signal to generate the first draft.
                    </p>
                  )}
                </Panel>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function UnconfiguredBrief() {
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-[var(--color-line-1)] pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
              Morning brief
            </p>
            <h1 className="mt-2 font-serif text-4xl leading-tight text-[var(--color-text-1)]">
              Persisted GTM run inspector
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveIndicator enabled={false} />
            <form action={bootstrapAction}>
              <button className="inline-flex items-center gap-2 rounded-md bg-[var(--color-text-1)] px-4 py-2 text-sm font-semibold text-[var(--color-ink-0)]">
                <Icon name="database" size={18} />
                Bootstrap Workspace
              </button>
            </form>
          </div>
        </header>
        <NoWorkspacePanel />
      </div>
    </main>
  );
}

function NoWorkspacePanel() {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5">
      <h2 className="text-sm font-semibold">No accessible workspace yet</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-2)]">
        Create or join the workspace before the brief can show Reps, Sources,
        Plays, approvals, and recovery state.
      </p>
    </section>
  );
}

function DemoBrief({
  result,
}: {
  result: Awaited<ReturnType<typeof runFirstVerticalSlice>>;
}) {
  const message = result.state.messages[0];
  return (
    <main className="min-h-screen px-6 py-8">
      <div className="mx-auto max-w-5xl rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-6">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-3)]">
          Demo mode
        </p>
        <h1 className="mt-2 font-serif text-4xl">Maya ran the funding-signal play</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--color-text-2)]">
          Set `DATABASE_URL` and run migrations to use the persisted app flow.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Metric label="Decision" value={result.output.decision} />
          <Metric label="Judge" value={result.output.eval_score.toFixed(2)} />
          <Metric label="Memory" value={result.proceduralScoreAfterOutcome.toFixed(2)} />
        </div>
        <pre className="mt-6 whitespace-pre-wrap rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] p-4 text-sm leading-6 text-[var(--color-text-2)]">
          {message?.body}
        </pre>
      </div>
    </main>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[var(--color-line-1)] bg-[var(--color-ink-0)] p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--color-text-1)]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className="rounded-md border border-[var(--color-line-1)] bg-[var(--color-ink-1)] px-3 py-2 text-sm"
      />
    </label>
  );
}

function formatTime(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function workflowLabel(name: string): string {
  if (name === "signals.rss_ingest.v1") return "RSS ingestion";
  if (name === "play.signal_to_email.v1") return "Signal email play";
  return name;
}

function eventLabel(eventType: string | null): string {
  if (!eventType) return "-";
  return eventLabels[eventType] ?? eventType;
}

function eventMeta(event: unknown): string | null {
  if (!event || typeof event !== "object") return null;
  const source = (event as { source?: unknown }).source;
  const idempotencyKey = (event as { idempotency_key?: unknown }).idempotency_key;
  if (typeof source !== "string") return null;
  return typeof idempotencyKey === "string" && idempotencyKey
    ? `${source} · ${idempotencyKey}`
    : source;
}

function formatScore(value: number | null): string {
  return value == null ? "-" : value.toFixed(2);
}

function axisScore(notes: Record<string, unknown> | null, axis: string): number | null {
  const axes = notes?.axes;
  if (!axes || typeof axes !== "object" || Array.isArray(axes)) return null;
  const value = (axes as Record<string, unknown>)[axis];
  return typeof value === "number" ? value : null;
}

function verificationValue(value: boolean | null | undefined): string {
  return value === true ? "verified" : value === false ? "pending" : "-";
}

function TraceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 md:grid-cols-[90px_1fr]">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-text-3)]">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-semibold capitalize text-[var(--color-text-1)]">
        {value}
      </dd>
    </div>
  );
}

function DecisionForm({
  id,
  decision,
  label,
}: {
  id: string;
  decision: "approved" | "rejected";
  label: string;
}) {
  return (
    <form action={decideApprovalAction}>
      <input type="hidden" name="approval_id" value={id} />
      <input type="hidden" name="decision" value={decision} />
      <button className="rounded-md border border-[var(--color-line-1)] px-3 py-1.5 text-sm font-semibold">
        {label}
      </button>
    </form>
  );
}

function RetryWorkflowForm({ id }: { id: string }) {
  return (
    <form action={retryWorkflowAction}>
      <input type="hidden" name="run_id" value={id} />
      <button className="inline-flex items-center gap-2 rounded-md border border-[var(--color-line-1)] px-3 py-1.5 text-sm font-semibold">
        <Icon name="restart_alt" size={16} />
        Retry
      </button>
    </form>
  );
}
