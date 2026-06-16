import { pathToFileURL } from "node:url";
import {
  normalizeAgentTraceExport,
  promoteTraceToEvalCase,
  recordAgentTraceEvalFailed,
  recordAgentTraceExported,
  recordAgentTraceSpan,
} from "../core/observability/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";

export interface AgentObservabilityVerification {
  ok: boolean;
  detail: string;
  trace_id: string;
  span_count: number;
  destination: string;
  eval_case_id: string;
}

export async function runAgentObservabilityVerification(): Promise<AgentObservabilityVerification> {
  const bus = createInMemoryEventBus();
  const workspace_id = "00000000-0000-4000-8000-000000000001";
  const trace_id = "00000000-0000-4000-8000-000000000101";
  const signal_id = "00000000-0000-4000-8000-000000000201";

  const run = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    span_id: "00000000-0000-4000-8000-000000000301",
    kind: "agent.run",
    name: "message.personalization_graph.v1",
    graph_name: "message.personalization_graph.v1",
    primitive_refs: { signal_id },
    started_at: "2026-06-15T10:00:00.000Z",
    ended_at: "2026-06-15T10:00:01.000Z",
    attributes: { runtime: "langgraph" },
  });
  const judge = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    span_id: "00000000-0000-4000-8000-000000000302",
    parent_span_id: run.span_id,
    kind: "eval.judge",
    name: "hot-path-judge",
    status: "error",
    graph_name: "message.personalization_graph.v1",
    node_name: "judge",
    primitive_refs: { signal_id },
    started_at: "2026-06-15T10:00:00.400Z",
    ended_at: "2026-06-15T10:00:00.800Z",
    attributes: { draft_body: "Private draft copy should not leave the journal." },
    error: { message: "Unsupported proof point." },
  });

  const normalized = normalizeAgentTraceExport({
    workspace_id,
    trace_id,
    destination: "openinference",
    spans: [run, judge],
    external_export_allowed: true,
  });
  if (normalized.redaction.pii !== "redacted") {
    throw new Error("Expected normalized trace export to redact PII.");
  }
  if (normalized.spans.some((span) => JSON.stringify(span).includes("Private draft copy"))) {
    throw new Error("Normalized trace export leaked a private draft body.");
  }

  await recordAgentTraceExported(bus, {
    workspace_id,
    destination: normalized.destination,
    trace_id,
    span_count: normalized.span_count,
    redaction: normalized.redaction,
  });

  const evalCase = promoteTraceToEvalCase({
    trace_id,
    spans: [run, judge],
    failure_kind: "unsupported_proof",
    reason: "Hot-path judge rejected an unsupported proof point.",
    source_span_id: judge.span_id,
  });
  await recordAgentTraceEvalFailed(bus, {
    workspace_id,
    trace_id,
    span_id: judge.span_id,
    eval_case_id: evalCase.eval_case_id,
    failure_kind: evalCase.failure_kind,
    reason: evalCase.reason,
  });

  return {
    ok: true,
    detail: "Agent observability recorded spans, normalized a redacted export, and promoted a failed judge span to an eval candidate.",
    trace_id,
    span_count: normalized.span_count,
    destination: normalized.destination,
    eval_case_id: evalCase.eval_case_id,
  };
}

async function main(): Promise<void> {
  const result = await runAgentObservabilityVerification();
  console.log("Agent observability verification");
  console.log(`  OK trace=${result.trace_id}`);
  console.log(`  OK spans=${result.span_count} destination=${result.destination}`);
  console.log(`  OK eval_case=${result.eval_case_id}`);
  console.log(`\n${result.detail}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
