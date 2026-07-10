import { redirect } from "next/navigation";
import { EmptyState } from "@/components/dashboard/Shell";
import Icon from "@/components/Icon";
import PendingSubmitButton from "@/components/PendingSubmitButton";
import { recoverTransientDispatchesAction } from "../actions";
import { getPool } from "@/core/substrate/storage/index.ts";
import {
  canUseWorkspaceOps,
  getActiveWorkspaceSessionForDashboard,
} from "@/lib/workspace";
import {
  checkProductReadinessCached,
  type ProductReadiness,
  type ProductReadinessStatus,
} from "@/core/product/health";
import {
  getWorkspaceAgentObservabilitySummary,
  type AgentObservabilitySummary,
  type AgentTraceSummary,
} from "@/core/product/agent-observability";
import { loadDashboardData } from "../server-data";

export const dynamic = "force-dynamic";

interface DispatchCounts {
  pending: number;
  delivered_24h: number;
  dead_lettered: number;
  retrying_transient_pending: number;
}

function emptyDispatchCounts(): DispatchCounts {
  return {
    pending: 0,
    delivered_24h: 0,
    dead_lettered: 0,
    retrying_transient_pending: 0,
  };
}

interface TransportAlert {
  kind: "dead_lettered" | "retrying";
  event_id: string;
  event_type: string;
  attempts: number;
  last_error: string | null;
  happened_at: string;
  source: string;
  producer_ref: string | null;
}

function unavailableReadiness(): ProductReadiness {
  return {
    service: "bombsell-product",
    status: "degraded",
    ready: false,
    checked_at: new Date().toISOString(),
    checks: [
      {
        name: "runtime health",
        status: "degraded",
        detail: "Runtime health is temporarily unavailable.",
      },
    ],
  };
}

function emptyAgentObservabilitySummary(
  workspaceId: string,
): AgentObservabilitySummary {
  return {
    workspace_id: workspaceId,
    generated_at: new Date().toISOString(),
    lookback_hours: 24,
    trace_id: null,
    trace_count: 0,
    span_count: 0,
    error_span_count: 0,
    blocked_span_count: 0,
    deferred_span_count: 0,
    eval_failure_count: 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    estimated_cost_usd: 0,
    redaction: {
      pii_redacted_trace_count: 0,
      external_export_count: 0,
      raw_export_blocked: false,
    },
    traces: [],
    eval_failures: [],
  };
}

async function loadDispatchCounts(workspaceId: string): Promise<DispatchCounts> {
  const pool = getPool();
  const { rows } = await pool.query<{
    pending: string;
    delivered_24h: string;
    dead_lettered: string;
    retrying_transient_pending: string;
  }>(
    `select
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1 and status = 'pending') as pending,
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1 and status = 'delivered'
           and delivered_at >= now() - interval '24 hours') as delivered_24h,
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1 and status = 'dead_lettered') as dead_lettered,
       (select count(*)::text from event_nats_dispatches
         where workspace_id = $1
           and status = 'pending'
           and last_error in ('CONNECTION_CLOSED', 'TIMEOUT')
           and attempts >= 3) as retrying_transient_pending`,
    [workspaceId],
  );
  const row = rows[0] ?? null;
  return {
    pending: Number(row?.pending ?? 0),
    delivered_24h: Number(row?.delivered_24h ?? 0),
    dead_lettered: Number(row?.dead_lettered ?? 0),
    retrying_transient_pending: Number(row?.retrying_transient_pending ?? 0),
  };
}

async function loadTransportAlerts(workspaceId: string): Promise<TransportAlert[]> {
  const pool = getPool();
  const { rows } = await pool.query<{
    kind: "dead_lettered" | "retrying";
    event_id: string;
    event_type: string;
    attempts: number;
    last_error: string | null;
    happened_at: Date | string;
    source: string;
    producer_ref: string | null;
  }>(
    `select *
       from (
         select
           'dead_lettered'::text as kind,
           d.event_id,
           e.event_type,
           d.attempts,
           d.last_error,
           d.dead_lettered_at as happened_at,
           e.source,
           e.producer_ref
         from event_nats_dispatches d
         join events e on e.id = d.event_id
        where d.workspace_id = $1
          and d.status = 'dead_lettered'
        union all
        select
           'retrying'::text as kind,
           d.event_id,
           e.event_type,
           d.attempts,
           d.last_error,
           d.updated_at as happened_at,
           e.source,
           e.producer_ref
         from event_nats_dispatches d
         join events e on e.id = d.event_id
        where d.workspace_id = $1
          and d.status = 'pending'
          and d.last_error in ('CONNECTION_CLOSED', 'TIMEOUT')
          and d.attempts >= 3
       ) alerts
      order by happened_at desc nulls last
      limit 100`,
    [workspaceId],
  );
  return rows.map((row) => ({
    kind: row.kind,
    event_id: row.event_id,
    event_type: row.event_type,
    attempts: row.attempts,
    last_error: row.last_error,
    happened_at:
      row.happened_at instanceof Date
        ? row.happened_at.toISOString()
        : String(row.happened_at),
    source: row.source,
    producer_ref: row.producer_ref,
  }));
}

function timeAgo(d: string | Date | null): string {
  if (!d) return "never";
  const diff = Date.now() - new Date(d).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function HealthPage() {
  const session = await getActiveWorkspaceSessionForDashboard("health");
  if (!session) {
    return (
      <section className="section-canvas p-6">
        <p className="brief-kicker">Health</p>
        <h1 className="mt-4 text-[34px] font-semibold leading-tight text-[var(--color-text-1)]">
          No workspace selected.
        </h1>
      </section>
    );
  }
  if (!canUseWorkspaceOps(session)) redirect("/dashboard/brief");

  const pool = getPool();
  const [counts, alerts, readiness, observability] = await Promise.all([
    loadDashboardData(
      "health",
      "dispatch counts",
      emptyDispatchCounts(),
      () => loadDispatchCounts(session.workspace.id),
    ),
    loadDashboardData(
      "health",
      "transport alerts",
      [],
      () => loadTransportAlerts(session.workspace.id),
    ),
    loadDashboardData(
      "health",
      "runtime health",
      unavailableReadiness(),
      () => checkProductReadinessCached({ pool, liveProbes: true }),
    ),
    loadDashboardData(
      "health",
      "agent observability",
      emptyAgentObservabilitySummary(session.workspace.id),
      () =>
        getWorkspaceAgentObservabilitySummary(
          { lookback_hours: 24, limit: 6, span_limit: 4 },
          { workspace_id: session.workspace.id, user_id: session.user_id },
          pool,
        ),
    ),
  ]);

  return (
    <div className="space-y-10">
      <section className="section-canvas min-h-[420px] p-5 sm:p-8">
        <div className="section-thread section-thread-a" />
        <div className="grid gap-8 lg:grid-cols-[1fr_340px] lg:items-end">
          <div>
            <p className="brief-kicker">Health</p>
            <h1 className="mt-4 max-w-3xl text-[38px] font-semibold leading-[1.04] tracking-[0] text-[var(--color-text-1)] sm:text-[58px]">
              Quiet systems, clear exceptions.
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--color-text-2)]">
              Platform readiness and owner-only recovery moments. Everyday outreach stays with the agent.
            </p>
          </div>
          <div className="section-note">
            <p className="text-sm font-semibold text-[var(--color-text-1)]">Work health</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <State label="Waiting" value={counts.pending} />
              <State label="Retrying" value={counts.retrying_transient_pending} />
              <State label="Moved" value={counts.delivered_24h} />
              <State label="Needs review" value={counts.dead_lettered} />
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="fact_check" size={18} />
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Runtime health</h2>
        </div>
        <ReadinessPanel readiness={readiness} />
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="brief-note-icon">
            <Icon name="account_tree" size={18} />
          </span>
          <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Agent observability</h2>
        </div>
        <AgentObservabilityPanel observability={observability} />
      </section>

      <section className="mt-6 section-canvas p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="brief-note-icon">
              <Icon name="report" size={18} />
            </span>
            <h2 className="text-lg font-semibold text-[var(--color-text-1)]">Needs attention</h2>
          </div>
          {alerts.length > 0 ? (
            <form action={recoverTransientDispatchesAction}>
              <input type="hidden" name="return_to" value="/dashboard/health" />
              <input type="hidden" name="limit" value="100" />
              <PendingSubmitButton
                className="rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
                pendingLabel="Recovering"
              >
                Recover transient failures
              </PendingSubmitButton>
            </form>
          ) : null}
        </div>
        {alerts.length === 0 ? (
          <EmptyState
            title="Nothing needs attention"
            hint="Background work and recovery health are normal."
          />
        ) : (
          <ul className="grid gap-2">
            {alerts.map((d) => (
              <li key={`${d.kind}:${d.event_id}`} className="rounded-[12px] bg-[var(--color-ink-0)] px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:flex-nowrap">
                  <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-3)] sm:w-24 sm:text-center">
                    {d.kind === "retrying" ? "retrying" : "dead letter"}
                  </span>
                  <span className="min-w-0 max-w-full truncate text-xs text-[var(--color-text-3)] sm:w-44 sm:shrink-0">
                    {d.event_type}
                  </span>
                  <p className="min-w-0 flex-1 truncate font-sans text-sm text-[var(--color-text-1)]">
                    {d.last_error ?? "(no error message)"}
                  </p>
                  <span className="text-xs tabular-nums text-[var(--color-text-3)] sm:w-20 sm:text-right">
                    {d.attempts} tries
                  </span>
                  <span className="text-xs tabular-nums text-[var(--color-text-3)] sm:w-20 sm:text-right">
                    {timeAgo(d.happened_at)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[var(--color-text-4)]">
                  Event {d.event_id}. Source {d.source}
                  {d.producer_ref ? `. Producer ${d.producer_ref}` : ""}
                </p>
                {d.kind === "dead_lettered" ? (
                  <form
                    action={`/api/internal/ops/dead-letter/redrive?event_id=${encodeURIComponent(d.event_id)}`}
                    method="POST"
                    className="mt-2"
                  >
                    <PendingSubmitButton
                      className="rounded-[8px] bg-[var(--color-accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--color-accent)]"
                      pendingLabel="Retrying"
                    >
                      Retry
                    </PendingSubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AgentObservabilityPanel({
  observability,
}: {
  observability: AgentObservabilitySummary;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <State label="Traces" value={observability.trace_count} />
        <State label="Spans" value={observability.span_count} />
        <State label="Errors" value={observability.error_span_count} />
        <State label="Eval cases" value={observability.eval_failure_count} />
        <State label="Tokens" value={observability.total_prompt_tokens + observability.total_completion_tokens} />
        <State label="Cost" value={formatCost(observability.estimated_cost_usd)} />
      </div>
      <div className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-4)]">
            Last 24h
          </span>
          <span className="text-xs text-[var(--color-text-3)]">
            {observability.redaction.pii_redacted_trace_count} redacted traces
          </span>
          <span className="text-xs text-[var(--color-text-3)]">
            {observability.redaction.external_export_count} external exports
          </span>
          {observability.redaction.raw_export_blocked ? (
            <span className="text-xs font-semibold text-[var(--color-accent)]">
              Raw export blocked
            </span>
          ) : null}
        </div>
      </div>
      {observability.traces.length === 0 ? (
        <EmptyState
          title="No agent traces yet"
          hint="No recent trace activity in this workspace."
        />
      ) : (
        <ul className="grid gap-2">
          {observability.traces.map((trace) => (
            <AgentTraceItem key={trace.trace_id} trace={trace} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentTraceItem({ trace }: { trace: AgentTraceSummary }) {
  const primaryGraphName = trace.graph_names[0] ?? null;
  const primarySpan = trace.spans[0] ?? null;
  const label = primaryGraphName ?? primarySpan?.name ?? "agent trace";
  return (
    <li className="rounded-[12px] bg-[var(--color-ink-0)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <TraceStatusDot status={trace.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-1)]">
          {label}
        </span>
        <span className="text-xs font-semibold text-[var(--color-text-3)]">
          {trace.status}
        </span>
        <span className="text-xs tabular-nums text-[var(--color-text-3)]">
          {timeAgo(trace.last_seen_at)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-3)]">
        <span>{trace.span_count} spans</span>
        <span>{trace.error_span_count} errors</span>
        <span>{trace.eval_failure_count} eval cases</span>
        <span>{trace.total_prompt_tokens + trace.total_completion_tokens} tokens</span>
        <span>{formatCost(trace.estimated_cost_usd)}</span>
        {trace.model_names.length > 0 ? <span>{trace.model_names.join(", ")}</span> : null}
      </div>
      {trace.latest_error ? (
        <p className="mt-2 truncate text-xs text-[var(--color-accent)]">
          {trace.latest_error.message}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {primitiveRefLabels(trace).map((ref) => (
          <span
            key={ref}
            className="rounded-[7px] border border-[var(--color-line-1)] px-2 py-1 text-[11px] text-[var(--color-text-3)]"
          >
            {ref}
          </span>
        ))}
        {trace.export_destinations.map((destination) => (
          <span
            key={destination}
            className="rounded-[7px] border border-[var(--color-line-1)] px-2 py-1 text-[11px] text-[var(--color-text-3)]"
          >
            exported {destination}
          </span>
        ))}
      </div>
    </li>
  );
}

function ReadinessPanel({ readiness }: { readiness: ProductReadiness }) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[var(--color-ink-0)] px-4 py-3">
        <StatusDot status={readiness.status} />
        <p className="font-sans text-sm font-semibold text-[var(--color-text-1)]">
          Product runtime is {readiness.status}
        </p>
        <span className="text-xs text-[var(--color-text-3)]">
          Checked {timeAgo(readiness.checked_at)}
        </span>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {readiness.checks.map((check) => (
          <div
            key={check.name}
            className="rounded-[12px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <StatusDot status={check.status} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-1)]">
                {check.name}
              </span>
              <span className="text-xs font-semibold text-[var(--color-text-3)]">
                {check.status}
              </span>
            </div>
            {check.detail ? <ReadinessDetail detail={check.detail} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadinessDetail({ detail }: { detail: string }) {
  if (detail.length <= 180) {
    return (
      <p className="mt-2 break-words text-xs leading-5 text-[var(--color-text-3)]">
        {detail}
      </p>
    );
  }

  return (
    <details className="group mt-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--color-accent)] marker:text-[var(--color-accent)]">
        Details
      </summary>
      <p className="mt-2 max-h-40 overflow-auto break-words rounded-[8px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 font-mono text-[11px] leading-5 text-[var(--color-text-3)]">
        {detail}
      </p>
    </details>
  );
}

function StatusDot({ status }: { status: ProductReadinessStatus }) {
  const className =
    status === "ok"
      ? "dot dot-running"
      : status === "degraded"
        ? "dot dot-degraded"
        : "dot dot-idle";
  return <span className={className} />;
}

function TraceStatusDot({ status }: { status: AgentTraceSummary["status"] }) {
  const className =
    status === "ok"
      ? "dot dot-running"
      : status === "error" || status === "blocked"
        ? "dot dot-degraded"
        : "dot dot-idle";
  return <span className={className} />;
}

function State({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="rounded-[10px] border border-[var(--color-line-1)] bg-[var(--color-ink-2)] p-3 text-center">
      <strong className="block text-2xl font-semibold tabular-nums text-[var(--color-text-1)]">{value}</strong>
      <span className="mt-1 block text-xs text-[var(--color-text-3)]">{label}</span>
    </span>
  );
}

function formatCost(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(5)}`;
  return `$${value.toFixed(2)}`;
}

function primitiveRefLabels(trace: AgentTraceSummary): string[] {
  const refs = trace.primitive_refs;
  return [
    refs.rep_id ? `Agent ${shortId(refs.rep_id)}` : null,
    refs.signal_id ? `Signal ${shortId(refs.signal_id)}` : null,
    refs.play_id ? `Path ${shortId(refs.play_id)}` : null,
    refs.conversation_id ? `Conversation ${shortId(refs.conversation_id)}` : null,
    refs.outcome_id ? `Result ${shortId(refs.outcome_id)}` : null,
  ].filter((value): value is string => Boolean(value));
}

function shortId(value: string): string {
  return value.slice(0, 8);
}
