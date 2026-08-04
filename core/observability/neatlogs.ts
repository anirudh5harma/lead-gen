import type { EventBus, Subscription } from "../substrate/events/index.ts";
import {
  normalizeAgentTraceExport,
  recordAgentTraceExported,
} from "./agent-traces.ts";
import type { AgentTraceSpanPayload } from "./agent-traces.ts";

type NeatlogsFetch = typeof fetch;

const DEFAULT_ENDPOINT = "https://ingest.neatlogs.com";
const DEFAULT_PROJECT = "bombsell";
const DEFAULT_FLUSH_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_SPANS_PER_TRACE = 200;

export interface NeatlogsTraceExporterOptions {
  writeKey: string;
  project?: string;
  endpoint?: string;
  flushDelayMs?: number;
  timeoutMs?: number;
  maxSpansPerTrace?: number;
  fetchImpl?: NeatlogsFetch;
  logger?: Pick<Console, "warn">;
}

export interface NeatlogsTraceExporter {
  readonly enabled: true;
  flush(): Promise<void>;
  close(): Promise<void>;
}

interface BufferedTrace {
  workspace_id: string;
  trace_id: string;
  spans: AgentTraceSpanPayload[];
  timer: ReturnType<typeof setTimeout> | null;
}

interface NeatlogsTraceNode {
  name: string;
  kind: NeatlogsSpanKind;
  model?: string;
  tokens?: { prompt: number; completion: number; total: number };
  status?: "OK" | "ERROR";
  error?: string;
  start?: string;
  end?: string;
  duration_ms?: number;
  metadata: Record<string, unknown>;
  children?: NeatlogsTraceNode[];
}

type NeatlogsSpanKind =
  | "WORKFLOW"
  | "AGENT"
  | "CHAIN"
  | "TASK"
  | "LLM"
  | "TOOL"
  | "RETRIEVER"
  | "GUARDRAIL"
  | "EVALUATOR";

/**
 * Exports the existing typed trace events to Neatlogs' free HTTP ingest path.
 * The exporter is intentionally optional and fail-open: Bombsell's event bus
 * remains the source of truth and a vendor outage never blocks a workflow.
 */
export async function createNeatlogsTraceExporter(
  bus: EventBus,
  options: NeatlogsTraceExporterOptions,
): Promise<NeatlogsTraceExporter> {
  const writeKey = options.writeKey.trim();
  if (!writeKey) throw new Error("Neatlogs write key cannot be empty");

  const endpoint = (options.endpoint?.trim() || DEFAULT_ENDPOINT).replace(/\/$/, "");
  const project = options.project?.trim() || DEFAULT_PROJECT;
  const flushDelayMs = positiveInteger(options.flushDelayMs, DEFAULT_FLUSH_DELAY_MS);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxSpansPerTrace = positiveInteger(
    options.maxSpansPerTrace,
    DEFAULT_MAX_SPANS_PER_TRACE,
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const buffers = new Map<string, BufferedTrace>();
  const inFlight = new Map<string, Promise<void>>();
  let closed = false;

  const flushTrace = async (key: string): Promise<void> => {
    const existing = inFlight.get(key);
    if (existing) return existing;

    const buffered = buffers.get(key);
    if (!buffered) return;
    buffers.delete(key);
    if (buffered.timer) clearTimeout(buffered.timer);
    buffered.timer = null;

    const task = sendTrace(buffered).finally(() => {
      inFlight.delete(key);
      if (buffers.has(key)) void flushTrace(key);
    });
    inFlight.set(key, task);
    return task;
  };

  const subscription: Subscription = await bus.subscribe(
    "agent.trace.span.recorded",
    (event) => {
      if (closed) return;
      const payload = event.payload;
      const key = `${event.workspace_id}:${payload.trace_id}`;
      const buffered = buffers.get(key) ?? {
        workspace_id: event.workspace_id,
        trace_id: payload.trace_id,
        spans: [],
        timer: null,
      };
      buffered.spans.push(payload);
      if (buffered.timer) clearTimeout(buffered.timer);
      buffered.timer = setTimeout(() => {
        void flushTrace(key);
      }, flushDelayMs);
      buffered.timer.unref?.();
      buffers.set(key, buffered);
      if (buffered.spans.length >= maxSpansPerTrace) {
        void flushTrace(key);
      }
    },
  );

  async function sendTrace(buffered: BufferedTrace): Promise<void> {
    try {
      const normalized = normalizeAgentTraceExport({
        workspace_id: buffered.workspace_id,
        destination: "neatlogs",
        trace_id: buffered.trace_id,
        spans: buffered.spans,
        external_export_allowed: true,
        raw_payload_exported: false,
      });
      const response = await fetchImpl(`${endpoint}/v1/trace`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": writeKey,
        },
        body: JSON.stringify(toNeatlogsTrace(normalized, project)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      await recordAgentTraceExported(bus, {
        workspace_id: buffered.workspace_id,
        destination: "neatlogs",
        trace_id: normalized.trace_id,
        span_count: normalized.span_count,
        redaction: normalized.redaction,
        producer_ref: "observability:neatlogs",
      });
    } catch (error) {
      options.logger?.warn(
        `[neatlogs] trace export skipped (${buffered.trace_id}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function flushAll(): Promise<void> {
    do {
      await Promise.all([
        ...[...buffers.keys()].map((key) => flushTrace(key)),
        ...inFlight.values(),
      ]);
    } while (buffers.size > 0 || inFlight.size > 0);
  }

  return {
    enabled: true,
    async flush(): Promise<void> {
      await flushAll();
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await subscription.unsubscribe();
      await flushAll();
    },
  };
}

export async function createNeatlogsTraceExporterFromEnv(
  bus: EventBus,
  env: Record<string, string | undefined> = process.env,
  options: Omit<NeatlogsTraceExporterOptions, "writeKey"> = {},
): Promise<NeatlogsTraceExporter | null> {
  const writeKey = env.NEATLOGS_WRITE_KEY?.trim();
  if (!writeKey) return null;
  return createNeatlogsTraceExporter(bus, {
    ...options,
    writeKey,
    project: options.project ?? env.NEATLOGS_PROJECT,
    endpoint: options.endpoint ?? env.NEATLOGS_ENDPOINT,
    flushDelayMs: options.flushDelayMs ?? parsePositiveInteger(env.NEATLOGS_FLUSH_DELAY_MS),
    timeoutMs: options.timeoutMs ?? parsePositiveInteger(env.NEATLOGS_TIMEOUT_MS),
  });
}

function toNeatlogsTrace(
  normalized: ReturnType<typeof normalizeAgentTraceExport>,
  project: string,
): NeatlogsTraceNode & { project: string } {
  const byId = new Map<string, NeatlogsTraceNode>();
  const roots: Array<{ span_id: string; node: NeatlogsTraceNode }> = [];
  for (const span of normalized.spans) {
    const node = toNeatlogsNode(
      span,
      span.parent_span_id === null,
      normalized.redaction.pii,
    );
    byId.set(span.span_id, node);
    if (!span.parent_span_id || !byId.has(span.parent_span_id)) {
      roots.push({ span_id: span.span_id, node });
      continue;
    }
    const parent = byId.get(span.parent_span_id);
    if (parent) appendChild(parent, node);
  }

  const root = roots.shift()?.node ?? {
    name: "bombsell-agent-run",
    kind: "WORKFLOW",
    metadata: {},
  };
  root.kind = "WORKFLOW";
  root.metadata = {
    ...root.metadata,
    "bombsell.workspace_id": normalized.workspace_id,
    "bombsell.trace_id": normalized.trace_id,
    "bombsell.redaction": normalized.redaction.pii,
  };
  for (const extra of roots) appendChild(root, extra.node);
  return { ...root, project };
}

function toNeatlogsNode(
  span: ReturnType<typeof normalizeAgentTraceExport>["spans"][number],
  isRoot: boolean,
  redaction: string,
): NeatlogsTraceNode {
  const node: NeatlogsTraceNode = {
    name: span.name,
    kind: isRoot ? "WORKFLOW" : mapKind(span.kind),
    metadata: {
      "bombsell.span_id": span.span_id,
      "bombsell.kind": span.kind,
      "bombsell.status": span.status,
      "bombsell.redaction": redaction,
      ...(span.graph_name ? { "bombsell.graph_name": span.graph_name } : {}),
      ...(span.node_name ? { "bombsell.node_name": span.node_name } : {}),
      ...(span.run_id ? { "bombsell.run_id": span.run_id } : {}),
      ...(span.thread_id ? { "bombsell.thread_id": span.thread_id } : {}),
      "bombsell.attribute_keys": Object.keys(span.attributes).sort(),
    },
  };
  if (span.model) node.model = span.model;
  if (span.prompt_tokens !== null || span.completion_tokens !== null) {
    const prompt = span.prompt_tokens ?? 0;
    const completion = span.completion_tokens ?? 0;
    node.tokens = { prompt, completion, total: prompt + completion };
  }
  if (span.status !== "ok") {
    node.status = "ERROR";
    // Error messages can contain provider or user content. Keep the vendor
    // trace useful without exporting that unbounded string across the boundary.
    node.error = "trace_span_error";
  }
  if (span.started_at) node.start = span.started_at;
  if (span.ended_at) node.end = span.ended_at;
  if (span.duration_ms !== null) node.duration_ms = span.duration_ms;
  return node;
}

function appendChild(parent: NeatlogsTraceNode, child: NeatlogsTraceNode): void {
  (parent.children ??= []).push(child);
}

function mapKind(kind: AgentTraceSpanPayload["kind"]): NeatlogsSpanKind {
  switch (kind) {
    case "llm.call":
      return "LLM";
    case "tool.call":
    case "channel.send":
      return "TOOL";
    case "memory.read":
      return "RETRIEVER";
    case "eval.judge":
      return "EVALUATOR";
    case "approval.interrupt":
      return "GUARDRAIL";
    case "agent.run":
      return "AGENT";
    case "langgraph.node":
      return "CHAIN";
    default:
      return "TASK";
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
