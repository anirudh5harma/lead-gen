import type { Pool } from "pg";
import type { EventPayload } from "../substrate/events/index.ts";
import { getPool } from "../substrate/storage/index.ts";
import {
  sanitizeTraceAttributes,
  type AgentTraceSpanPayload,
  type AgentTraceSpanStatus,
} from "../observability/index.ts";
import {
  assertProductWorkspaceAccess,
  type ProductWorkspaceSession,
} from "./app.ts";

type TraceSpanPayload = EventPayload<"agent.trace.span.recorded">;
type TraceExportPayload = EventPayload<"agent.trace.exported">;
type TraceEvalFailedPayload = EventPayload<"agent.trace.eval_failed">;
type TraceEventType =
  | "agent.trace.span.recorded"
  | "agent.trace.exported"
  | "agent.trace.eval_failed";

export interface AgentTraceEventRow {
  id: string;
  event_type: TraceEventType;
  payload: TraceSpanPayload | TraceExportPayload | TraceEvalFailedPayload;
  occurred_at: Date | string;
}

export interface AgentObservabilitySummaryInput {
  trace_id?: string | null;
  lookback_hours?: number;
  limit?: number;
  span_limit?: number;
}

export interface AgentObservabilitySummary {
  workspace_id: string;
  generated_at: string;
  lookback_hours: number;
  trace_id: string | null;
  trace_count: number;
  span_count: number;
  error_span_count: number;
  blocked_span_count: number;
  deferred_span_count: number;
  eval_failure_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  estimated_cost_usd: number;
  redaction: {
    pii_redacted_trace_count: number;
    external_export_count: number;
    raw_export_blocked: boolean;
  };
  traces: AgentTraceSummary[];
  eval_failures: AgentTraceEvalFailureSummary[];
}

export interface AgentTraceSummary {
  trace_id: string;
  status: AgentTraceSpanStatus;
  first_seen_at: string;
  last_seen_at: string;
  duration_ms: number | null;
  span_count: number;
  error_span_count: number;
  blocked_span_count: number;
  deferred_span_count: number;
  eval_failure_count: number;
  graph_names: string[];
  node_names: string[];
  model_names: string[];
  total_prompt_tokens: number;
  total_completion_tokens: number;
  estimated_cost_usd: number;
  primitive_refs: NonNullable<AgentTraceSpanPayload["primitive_refs"]>;
  latest_error: { message: string; name: string | null } | null;
  export_destinations: string[];
  redaction: {
    pii: "none" | "redacted" | "contains_pii";
    external_export_allowed: boolean;
    raw_payload_exported: boolean;
  };
  spans: AgentTraceSpanSummary[];
}

export interface AgentTraceSpanSummary {
  span_id: string;
  parent_span_id: string | null;
  kind: TraceSpanPayload["kind"];
  name: string;
  status: AgentTraceSpanStatus;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  graph_name: string | null;
  node_name: string | null;
  run_id: string | null;
  thread_id: string | null;
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  estimated_cost_usd: number | null;
  retry_count: number | null;
  attributes: Record<string, unknown>;
  error: { message: string; name: string | null } | null;
}

export interface AgentTraceEvalFailureSummary {
  eval_case_id: string;
  trace_id: string;
  span_id: string | null;
  failure_kind: string;
  reason: string;
  source_event_id: string | null;
  created_at: string;
}

export async function getWorkspaceAgentObservabilitySummary(
  input: AgentObservabilitySummaryInput,
  session: ProductWorkspaceSession,
  pool: Pool = getPool(),
): Promise<AgentObservabilitySummary> {
  await assertProductWorkspaceAccess(session, pool);
  const lookbackHours = clampInteger(input.lookback_hours ?? 24, 1, 24 * 30);
  const limit = clampInteger(input.limit ?? 20, 1, 100);
  const spanLimit = clampInteger(input.span_limit ?? 12, 1, 50);
  const rows = await loadTraceEvents(pool, {
    workspace_id: session.workspace_id,
    trace_id: cleanTraceId(input.trace_id),
    lookback_hours: lookbackHours,
    event_limit: input.trace_id ? Math.max(500, limit * spanLimit * 2) : limit * 60,
  });

  return summarizeAgentTraceEvents(rows, {
    workspace_id: session.workspace_id,
    lookback_hours: lookbackHours,
    trace_id: cleanTraceId(input.trace_id),
    limit,
    span_limit: spanLimit,
  });
}

export function summarizeAgentTraceEvents(
  rows: AgentTraceEventRow[],
  opts: {
    workspace_id: string;
    lookback_hours: number;
    trace_id?: string | null;
    limit?: number;
    span_limit?: number;
    now?: Date;
  },
): AgentObservabilitySummary {
  const limit = clampInteger(opts.limit ?? 20, 1, 100);
  const spanLimit = clampInteger(opts.span_limit ?? 12, 1, 50);
  const groups = new Map<string, {
    spans: TraceSpanPayload[];
    exports: TraceExportPayload[];
    failures: TraceEvalFailedPayload[];
    event_times: string[];
  }>();
  const orphanFailures: TraceEvalFailedPayload[] = [];

  for (const row of rows) {
    if (row.event_type === "agent.trace.span.recorded") {
      const payload = row.payload as TraceSpanPayload;
      const group = traceGroup(groups, payload.trace_id);
      group.spans.push(payload);
      group.event_times.push(toIso(row.occurred_at));
    } else if (row.event_type === "agent.trace.exported") {
      const payload = row.payload as TraceExportPayload;
      if (!payload.trace_id) continue;
      const group = traceGroup(groups, payload.trace_id);
      group.exports.push(payload);
      group.event_times.push(toIso(row.occurred_at));
    } else {
      const payload = row.payload as TraceEvalFailedPayload;
      const group = traceGroup(groups, payload.trace_id);
      group.failures.push(payload);
      group.event_times.push(toIso(row.occurred_at));
      orphanFailures.push(payload);
    }
  }

  const traces = [...groups.entries()]
    .map(([trace_id, group]) => buildTraceSummary(trace_id, group, spanLimit))
    .sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
    .slice(0, limit);
  const traceIds = new Set(traces.map((trace) => trace.trace_id));
  const evalFailures = orphanFailures
    .filter((failure) => traceIds.has(failure.trace_id))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .map((failure) => ({
      eval_case_id: failure.eval_case_id,
      trace_id: failure.trace_id,
      span_id: failure.span_id ?? null,
      failure_kind: failure.failure_kind,
      reason: failure.reason,
      source_event_id: failure.source_event_id ?? null,
      created_at: failure.created_at,
    }));

  return {
    workspace_id: opts.workspace_id,
    generated_at: (opts.now ?? new Date()).toISOString(),
    lookback_hours: opts.lookback_hours,
    trace_id: opts.trace_id ?? null,
    trace_count: traces.length,
    span_count: sum(traces, (trace) => trace.span_count),
    error_span_count: sum(traces, (trace) => trace.error_span_count),
    blocked_span_count: sum(traces, (trace) => trace.blocked_span_count),
    deferred_span_count: sum(traces, (trace) => trace.deferred_span_count),
    eval_failure_count: evalFailures.length,
    total_prompt_tokens: sum(traces, (trace) => trace.total_prompt_tokens),
    total_completion_tokens: sum(traces, (trace) => trace.total_completion_tokens),
    estimated_cost_usd: roundCost(sum(traces, (trace) => trace.estimated_cost_usd)),
    redaction: {
      pii_redacted_trace_count: traces.filter((trace) => trace.redaction.pii !== "none").length,
      external_export_count: sum(traces, (trace) => trace.export_destinations.length),
      raw_export_blocked: traces.some((trace) =>
        trace.redaction.raw_payload_exported && trace.redaction.pii !== "none"
      ),
    },
    traces,
    eval_failures: evalFailures,
  };
}

async function loadTraceEvents(
  pool: Pool,
  opts: {
    workspace_id: string;
    trace_id: string | null;
    lookback_hours: number;
    event_limit: number;
  },
): Promise<AgentTraceEventRow[]> {
  const { rows } = await pool.query<AgentTraceEventRow>(
    `select id::text,
            event_type::text as event_type,
            payload,
            occurred_at
       from events
      where workspace_id = $1
        and event_type in (
          'agent.trace.span.recorded',
          'agent.trace.exported',
          'agent.trace.eval_failed'
        )
        and occurred_at >= now() - ($2::text || ' hours')::interval
        and ($3::text is null or payload ->> 'trace_id' = $3)
      order by occurred_at desc
      limit $4`,
    [opts.workspace_id, opts.lookback_hours, opts.trace_id, opts.event_limit],
  );
  return rows;
}

function buildTraceSummary(
  trace_id: string,
  group: {
    spans: TraceSpanPayload[];
    exports: TraceExportPayload[];
    failures: TraceEvalFailedPayload[];
    event_times: string[];
  },
  spanLimit: number,
): AgentTraceSummary {
  const sortedSpans = [...group.spans].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
  const firstSeen = earliest([
    ...group.event_times,
    ...sortedSpans.map((span) => span.started_at),
  ]);
  const lastSeen = latest([
    ...group.event_times,
    ...sortedSpans.map((span) => span.ended_at ?? span.started_at),
    ...group.failures.map((failure) => failure.created_at),
    ...group.exports.map((item) => item.exported_at),
  ]);
  const latestError = [...sortedSpans]
    .reverse()
    .find((span) => span.error)?.error ?? null;

  return {
    trace_id,
    status: traceStatus(sortedSpans, group.failures),
    first_seen_at: firstSeen,
    last_seen_at: lastSeen,
    duration_ms: inferWindowDuration(firstSeen, lastSeen),
    span_count: sortedSpans.length,
    error_span_count: sortedSpans.filter((span) => span.status === "error").length,
    blocked_span_count: sortedSpans.filter((span) => span.status === "blocked").length,
    deferred_span_count: sortedSpans.filter((span) => span.status === "deferred").length,
    eval_failure_count: group.failures.length,
    graph_names: unique(sortedSpans.map((span) => span.graph_name)),
    node_names: unique(sortedSpans.map((span) => span.node_name)),
    model_names: unique(sortedSpans.map((span) => span.model)),
    total_prompt_tokens: sum(sortedSpans, (span) => span.prompt_tokens ?? 0),
    total_completion_tokens: sum(sortedSpans, (span) => span.completion_tokens ?? 0),
    estimated_cost_usd: roundCost(sum(sortedSpans, (span) => span.estimated_cost_usd ?? 0)),
    primitive_refs: mergePrimitiveRefs(sortedSpans),
    latest_error: latestError
      ? { message: latestError.message, name: latestError.name ?? null }
      : null,
    export_destinations: unique(group.exports.map((item) => item.destination)),
    redaction: traceRedaction(sortedSpans, group.exports),
    spans: sortedSpans.slice(-spanLimit).map(spanSummary),
  };
}

function spanSummary(span: TraceSpanPayload): AgentTraceSpanSummary {
  return {
    span_id: span.span_id,
    parent_span_id: span.parent_span_id ?? null,
    kind: span.kind,
    name: span.name,
    status: span.status,
    started_at: span.started_at,
    ended_at: span.ended_at ?? null,
    duration_ms: span.duration_ms ?? null,
    graph_name: span.graph_name ?? null,
    node_name: span.node_name ?? null,
    run_id: span.run_id ?? null,
    thread_id: span.thread_id ?? null,
    model: span.model ?? null,
    prompt_tokens: span.prompt_tokens ?? null,
    completion_tokens: span.completion_tokens ?? null,
    estimated_cost_usd: span.estimated_cost_usd ?? null,
    retry_count: span.retry_count ?? null,
    attributes: sanitizeTraceAttributes(span.attributes ?? {}).value,
    error: span.error
      ? { message: span.error.message, name: span.error.name ?? null }
      : null,
  };
}

function traceGroup(
  groups: Map<string, {
    spans: TraceSpanPayload[];
    exports: TraceExportPayload[];
    failures: TraceEvalFailedPayload[];
    event_times: string[];
  }>,
  trace_id: string,
): {
  spans: TraceSpanPayload[];
  exports: TraceExportPayload[];
  failures: TraceEvalFailedPayload[];
  event_times: string[];
} {
  const existing = groups.get(trace_id);
  if (existing) return existing;
  const created = { spans: [], exports: [], failures: [], event_times: [] };
  groups.set(trace_id, created);
  return created;
}

function traceStatus(
  spans: TraceSpanPayload[],
  failures: TraceEvalFailedPayload[],
): AgentTraceSpanStatus {
  if (failures.length > 0 || spans.some((span) => span.status === "error")) return "error";
  if (spans.some((span) => span.status === "blocked")) return "blocked";
  if (spans.some((span) => span.status === "deferred")) return "deferred";
  return "ok";
}

function traceRedaction(
  spans: TraceSpanPayload[],
  exports: TraceExportPayload[],
): AgentTraceSummary["redaction"] {
  const pii = spans.some((span) => span.redaction.pii === "contains_pii")
    ? "contains_pii"
    : spans.some((span) => span.redaction.pii === "redacted")
      ? "redacted"
      : "none";
  return {
    pii,
    external_export_allowed:
      spans.some((span) => span.redaction.external_export_allowed) ||
      exports.some((item) => item.redaction.external_export_allowed),
    raw_payload_exported:
      spans.some((span) => span.redaction.raw_payload_exported) ||
      exports.some((item) => item.redaction.raw_payload_exported),
  };
}

function mergePrimitiveRefs(
  spans: TraceSpanPayload[],
): NonNullable<AgentTraceSpanPayload["primitive_refs"]> {
  const merged: NonNullable<AgentTraceSpanPayload["primitive_refs"]> = {};
  for (const span of spans) {
    const refs = span.primitive_refs ?? {};
    for (const [key, value] of Object.entries(refs)) {
      if (value && merged[key as keyof typeof merged] === undefined) {
        merged[key as keyof typeof merged] = value;
      }
    }
  }
  return merged;
}

function earliest(values: Array<string | null | undefined>): string {
  const sorted = cleanIsoValues(values).sort((a, b) => Date.parse(a) - Date.parse(b));
  return sorted[0] ?? new Date(0).toISOString();
}

function latest(values: Array<string | null | undefined>): string {
  const sorted = cleanIsoValues(values).sort((a, b) => Date.parse(b) - Date.parse(a));
  return sorted[0] ?? new Date(0).toISOString();
}

function cleanIsoValues(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string =>
    Boolean(value) && Number.isFinite(Date.parse(value!))
  );
}

function inferWindowDuration(started_at: string, ended_at: string): number | null {
  const duration = Date.parse(ended_at) - Date.parse(started_at);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function sum<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((total, item) => total + fn(item), 0);
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function cleanTraceId(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}
