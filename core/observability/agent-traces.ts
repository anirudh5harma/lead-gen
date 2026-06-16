import { randomUUID } from "node:crypto";
import type { EventBus, EventPayload, EventSource } from "../substrate/events/index.ts";

type SpanPayload = EventPayload<"agent.trace.span.recorded">;
type ExportPayload = EventPayload<"agent.trace.exported">;
type EvalFailedPayload = EventPayload<"agent.trace.eval_failed">;

export type AgentTraceSpanPayload = SpanPayload;
export type AgentTraceExportDestination =
  | "internal"
  | "otel"
  | "openinference"
  | "phoenix"
  | "langfuse"
  | "langsmith"
  | "helicone"
  | "braintrust";
export type AgentTraceSpanKind = SpanPayload["kind"];
export type AgentTraceSpanStatus = SpanPayload["status"];
export type AgentTraceRedaction = SpanPayload["redaction"];

export interface NormalizedAgentTraceExport {
  workspace_id: string;
  destination: AgentTraceExportDestination;
  trace_id: string | null;
  span_count: number;
  redaction: AgentTraceRedaction;
  spans: Array<{
    span_id: string;
    parent_span_id: string | null;
    trace_id: string;
    kind: AgentTraceSpanKind;
    name: string;
    status: AgentTraceSpanStatus;
    started_at: string;
    ended_at: string | null;
    duration_ms: number | null;
    graph_name: string | null;
    node_name: string | null;
    run_id: string | null;
    thread_id: string | null;
    primitive_refs: SpanPayload["primitive_refs"];
    model: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    estimated_cost_usd: number | null;
    retry_count: number | null;
    attributes: Record<string, unknown>;
    error: SpanPayload["error"];
  }>;
}

export interface NormalizeAgentTraceExportInput {
  workspace_id: string;
  destination: AgentTraceExportDestination;
  trace_id?: string | null;
  spans: SpanPayload[];
  external_export_allowed?: boolean;
  raw_payload_exported?: boolean;
}

export interface TraceEvalCaseCandidate {
  eval_case_id: string;
  trace_id: string;
  failure_kind: string;
  reason: string;
  source_span_id: string | null;
  primitive_refs: SpanPayload["primitive_refs"];
  spans: Array<{
    span_id: string;
    kind: AgentTraceSpanKind;
    name: string;
    status: AgentTraceSpanStatus;
    graph_name: string | null;
    node_name: string | null;
    error: SpanPayload["error"];
    attributes: Record<string, unknown>;
  }>;
}

export interface RecordAgentTraceSpanInput {
  workspace_id: string;
  kind: AgentTraceSpanKind;
  name: string;
  status?: AgentTraceSpanStatus;
  span_id?: string;
  trace_id?: string;
  parent_span_id?: string | null;
  started_at?: Date | string;
  ended_at?: Date | string | null;
  duration_ms?: number | null;
  graph_name?: string | null;
  node_name?: string | null;
  run_id?: string | null;
  thread_id?: string | null;
  correlation_id?: string | null;
  causation_event_id?: string | null;
  primitive_refs?: SpanPayload["primitive_refs"];
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  estimated_cost_usd?: number | null;
  retry_count?: number | null;
  attributes?: Record<string, unknown>;
  redaction?: Partial<AgentTraceRedaction>;
  error?: Error | { message: string; name?: string | null } | null;
  source?: EventSource;
  producer_ref?: string | null;
}

export interface RecordAgentTraceExportInput {
  workspace_id: string;
  destination: string;
  trace_id?: string | null;
  span_count: number;
  export_id?: string;
  redaction?: Partial<AgentTraceRedaction>;
  source?: EventSource;
  producer_ref?: string | null;
}

export interface RecordAgentTraceEvalFailureInput {
  workspace_id: string;
  trace_id: string;
  failure_kind: string;
  reason: string;
  span_id?: string | null;
  eval_case_id?: string;
  source_event_id?: string | null;
  source?: EventSource;
  producer_ref?: string | null;
}

export class AgentTraceRedactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTraceRedactionError";
  }
}

export async function recordAgentTraceSpan(
  bus: EventBus,
  input: RecordAgentTraceSpanInput,
): Promise<SpanPayload> {
  const started_at = toIso(input.started_at ?? new Date()) ?? new Date().toISOString();
  const ended_at = input.ended_at === undefined ? null : toIso(input.ended_at);
  const redacted = sanitizeTraceAttributes(input.attributes ?? {});
  const redaction = normalizeRedaction(input.redaction, redacted.redacted);
  const payload: SpanPayload = {
    span_id: input.span_id ?? randomUUID(),
    trace_id: input.trace_id ?? input.correlation_id ?? randomUUID(),
    parent_span_id: input.parent_span_id ?? null,
    kind: input.kind,
    name: input.name,
    status: input.status ?? (input.error ? "error" : "ok"),
    started_at,
    ended_at,
    duration_ms: input.duration_ms ?? inferDurationMs(started_at, ended_at),
    graph_name: input.graph_name ?? null,
    node_name: input.node_name ?? null,
    run_id: input.run_id ?? null,
    thread_id: input.thread_id ?? null,
    correlation_id: input.correlation_id ?? null,
    causation_event_id: input.causation_event_id ?? null,
    primitive_refs: input.primitive_refs,
    model: input.model ?? null,
    prompt_tokens: input.prompt_tokens ?? null,
    completion_tokens: input.completion_tokens ?? null,
    estimated_cost_usd: input.estimated_cost_usd ?? null,
    retry_count: input.retry_count ?? null,
    attributes: redacted.value,
    redaction,
    error: input.error ? normalizeError(input.error) : null,
  };

  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "agent.trace.span.recorded",
    source: input.source ?? "system",
    producer_ref: input.producer_ref ?? `agent-trace:${input.kind}`,
    correlation_id: input.correlation_id ?? payload.trace_id,
    causation_id: input.causation_event_id ?? null,
    payload,
  });

  return payload;
}

export async function recordAgentTraceExported(
  bus: EventBus,
  input: RecordAgentTraceExportInput,
): Promise<ExportPayload> {
  const redaction = normalizeRedaction(input.redaction, input.redaction?.pii === "redacted");
  if (redaction.raw_payload_exported && redaction.pii !== "none") {
    throw new AgentTraceRedactionError(
      "Raw trace payload export is not allowed when the trace contains or redacts PII.",
    );
  }

  const payload: ExportPayload = {
    export_id: input.export_id ?? randomUUID(),
    destination: input.destination,
    trace_id: input.trace_id ?? null,
    span_count: input.span_count,
    redaction,
    exported_at: new Date().toISOString(),
  };

  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "agent.trace.exported",
    source: input.source ?? "system",
    producer_ref: input.producer_ref ?? `agent-trace-export:${input.destination}`,
    correlation_id: input.trace_id ?? null,
    payload,
  });

  return payload;
}

export async function recordAgentTraceEvalFailed(
  bus: EventBus,
  input: RecordAgentTraceEvalFailureInput,
): Promise<EvalFailedPayload> {
  const payload: EvalFailedPayload = {
    eval_case_id: input.eval_case_id ?? randomUUID(),
    trace_id: input.trace_id,
    span_id: input.span_id ?? null,
    failure_kind: input.failure_kind,
    reason: input.reason,
    source_event_id: input.source_event_id ?? null,
    created_at: new Date().toISOString(),
  };

  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "agent.trace.eval_failed",
    source: input.source ?? "system",
    producer_ref: input.producer_ref ?? "agent-trace:evaluation",
    correlation_id: input.trace_id,
    payload,
  });

  return payload;
}

export function normalizeAgentTraceExport(
  input: NormalizeAgentTraceExportInput,
): NormalizedAgentTraceExport {
  const traceSpans = input.trace_id
    ? input.spans.filter((span) => span.trace_id === input.trace_id)
    : input.spans;
  const sorted = [...traceSpans].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at),
  );
  let redacted = false;
  const spans = sorted.map((span) => {
    const attributes = sanitizeTraceAttributes(span.attributes ?? {});
    redacted ||= attributes.redacted || span.redaction.pii !== "none";
    return {
      span_id: span.span_id,
      parent_span_id: span.parent_span_id ?? null,
      trace_id: span.trace_id,
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
      primitive_refs: span.primitive_refs,
      model: span.model ?? null,
      prompt_tokens: span.prompt_tokens ?? null,
      completion_tokens: span.completion_tokens ?? null,
      estimated_cost_usd: span.estimated_cost_usd ?? null,
      retry_count: span.retry_count ?? null,
      attributes: attributes.value,
      error: span.error ?? null,
    };
  });
  const redaction = normalizeRedaction({
    pii: redacted ? "redacted" : "none",
    raw_payload_exported: input.raw_payload_exported ?? false,
    external_export_allowed: input.external_export_allowed ?? false,
  }, redacted);
  if (redaction.raw_payload_exported && redaction.pii !== "none") {
    throw new AgentTraceRedactionError(
      "Raw trace payload export is not allowed when the trace contains or redacts PII.",
    );
  }

  return {
    workspace_id: input.workspace_id,
    destination: input.destination,
    trace_id: input.trace_id ?? sorted[0]?.trace_id ?? null,
    span_count: spans.length,
    redaction,
    spans,
  };
}

export function promoteTraceToEvalCase(input: {
  trace_id: string;
  spans: SpanPayload[];
  failure_kind: string;
  reason: string;
  source_span_id?: string | null;
  eval_case_id?: string;
}): TraceEvalCaseCandidate {
  const matching = input.spans.filter((span) => span.trace_id === input.trace_id);
  const source = input.source_span_id
    ? matching.find((span) => span.span_id === input.source_span_id)
    : matching.find((span) => span.status === "error") ?? matching.at(-1);
  return {
    eval_case_id: input.eval_case_id ?? randomUUID(),
    trace_id: input.trace_id,
    failure_kind: input.failure_kind,
    reason: input.reason,
    source_span_id: source?.span_id ?? null,
    primitive_refs: source?.primitive_refs ?? {},
    spans: matching.map((span) => ({
      span_id: span.span_id,
      kind: span.kind,
      name: span.name,
      status: span.status,
      graph_name: span.graph_name ?? null,
      node_name: span.node_name ?? null,
      error: span.error ?? null,
      attributes: sanitizeTraceAttributes(span.attributes ?? {}).value,
    })),
  };
}

export function sanitizeTraceAttributes(
  attributes: Record<string, unknown>,
): { value: Record<string, unknown>; redacted: boolean } {
  const result = sanitizeValue(attributes, "");
  return {
    value: result.value as Record<string, unknown>,
    redacted: result.redacted,
  };
}

function normalizeRedaction(
  input: Partial<AgentTraceRedaction> | undefined,
  redacted: boolean,
): AgentTraceRedaction {
  return {
    pii: input?.pii ?? (redacted ? "redacted" : "none"),
    raw_payload_exported: input?.raw_payload_exported ?? false,
    external_export_allowed: input?.external_export_allowed ?? false,
  };
}

function sanitizeValue(value: unknown, key: string): { value: unknown; redacted: boolean } {
  if (isSensitiveTraceKey(key)) return { value: "[redacted]", redacted: true };
  if (value instanceof Date) return { value: value.toISOString(), redacted: false };
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const child = sanitizeValue(item, "");
      redacted ||= child.redacted;
      return child.value;
    });
    return { value: next, redacted };
  }
  if (value && typeof value === "object") {
    let redacted = false;
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const child = sanitizeValue(childValue, childKey);
      redacted ||= child.redacted;
      next[childKey] = child.value;
    }
    return { value: next, redacted };
  }
  return { value, redacted: false };
}

function isSensitiveTraceKey(key: string): boolean {
  return /(body|content|email|phone|token|secret|password|authorization|cookie|access_token|refresh_token)/i
    .test(key);
}

function normalizeError(
  error: Error | { message: string; name?: string | null },
): NonNullable<SpanPayload["error"]> {
  return {
    message: error.message,
    name: "name" in error ? error.name ?? null : null,
  };
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function inferDurationMs(started_at: string, ended_at: string | null): number | null {
  if (!ended_at) return null;
  const duration = Date.parse(ended_at) - Date.parse(started_at);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}
