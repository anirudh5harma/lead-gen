import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  AgentTraceRedactionError,
  createNeatlogsTraceExporter,
  normalizeAgentTraceExport,
  promoteTraceToEvalCase,
  recordAgentTraceEvalFailed,
  recordAgentTraceExported,
  recordAgentTraceSpan,
  sanitizeTraceAttributes,
} from "../core/observability/index.ts";
import {
  getWorkspaceAgentObservabilitySummary,
  summarizeAgentTraceEvents,
} from "../core/product/agent-observability.ts";
import { verifiedProductWorkspaceSession } from "../core/product/app.ts";
import {
  appendPostgresEvent,
  createInMemoryEventBus,
} from "../core/substrate/events/index.ts";
import { setupPg } from "./_pg.ts";

test("agent observability: records typed spans through the event bus", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const signal_id = randomUUID();
  const play_id = randomUUID();

  const span = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "llm.call",
    name: "message.personalization_graph.v1:writer",
    status: "ok",
    graph_name: "message.personalization_graph.v1",
    node_name: "writer",
    run_id: "run-1",
    thread_id: "thread-1",
    primitive_refs: { signal_id, play_id },
    model: "deepseek-v4-flash",
    prompt_tokens: 120,
    completion_tokens: 60,
    estimated_cost_usd: 0.000_033_6,
    retry_count: 0,
    attributes: { skill_id: "trigger-led-opener" },
  });

  assert.equal(span.kind, "llm.call");
  assert.equal(bus.published.length, 1);
  assert.equal(bus.published[0].event_type, "agent.trace.span.recorded");
  assert.equal(bus.published[0].workspace_id, workspace_id);
  assert.equal(bus.published[0].correlation_id, trace_id);
  assert.equal(bus.published[0].payload.primitive_refs.signal_id, signal_id);
  assert.equal(bus.published[0].payload.model, "deepseek-v4-flash");
});

test("agent observability: exports nested redacted traces to Neatlogs", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const exporter = await createNeatlogsTraceExporter(bus, {
    writeKey: "nlw_test",
    project: "bombsell",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ success: true, trace_id: "neat-trace", spans: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const root = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "agent.run",
    name: "message.personalization_graph.v1",
    graph_name: "message.personalization_graph.v1",
    started_at: "2026-06-15T10:00:00.000Z",
    ended_at: "2026-06-15T10:00:03.000Z",
    attributes: { safe_label: "writer" },
  });
  await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    parent_span_id: root.span_id,
    kind: "llm.call",
    name: "writer",
    model: "deepseek-v4-flash",
    prompt_tokens: 20,
    completion_tokens: 8,
    status: "error",
    error: { message: "private@example.com failed to personalize" },
    started_at: "2026-06-15T10:00:01.000Z",
    ended_at: "2026-06-15T10:00:02.000Z",
    attributes: { prompt_content: "private draft" },
  });

  await exporter.flush();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://ingest.neatlogs.com/v1/trace");
  assert.equal(requests[0]?.init.headers && (requests[0].init.headers as Record<string, string>)["x-api-key"], "nlw_test");
  const payload = JSON.parse(String(requests[0]?.init.body));
  assert.equal(payload.project, "bombsell");
  assert.equal(payload.name, "message.personalization_graph.v1");
  assert.equal(payload.metadata["bombsell.workspace_id"], workspace_id);
  assert.equal(payload.children[0].kind, "LLM");
  assert.equal(payload.children[0].model, "deepseek-v4-flash");
  assert.deepEqual(payload.children[0].tokens, { prompt: 20, completion: 8, total: 28 });
  assert.equal(payload.children[0].input, undefined);
  assert.equal(payload.children[0].error, "trace_span_error");
  assert.equal(JSON.stringify(payload).includes("private@example.com"), false);
  assert.equal(payload.children[0].metadata["bombsell.redaction"], "redacted");
  assert.deepEqual(payload.children[0].metadata["bombsell.attribute_keys"], ["prompt_content"]);
  assert.equal(bus.published.at(-1)?.event_type, "agent.trace.exported");

  await exporter.close();
});

test("agent observability: keeps Neatlogs failures out of the workflow", async () => {
  const bus = createInMemoryEventBus();
  const exporter = await createNeatlogsTraceExporter(bus, {
    writeKey: "nlw_test",
    project: "bombsell",
    fetchImpl: async () => {
      throw new Error("Neatlogs unavailable");
    },
  });

  await recordAgentTraceSpan(bus, {
    workspace_id: randomUUID(),
    kind: "tool.call",
    name: "company.lookup",
  });

  await assert.doesNotReject(exporter.flush());
  assert.equal(bus.published.some((event) => event.event_type === "agent.trace.exported"), false);
  await exporter.close();
});

test("agent observability: flushes spans that arrive during an in-flight export", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const requests: Array<{ body: string }> = [];
  let releaseFirst: (() => void) | null = null;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const exporter = await createNeatlogsTraceExporter(bus, {
    writeKey: "nlw_test",
    project: "bombsell",
    fetchImpl: async (_input, init) => {
      requests.push({ body: String(init?.body) });
      if (requests.length === 1) await firstRequest;
      return new Response(JSON.stringify({ success: true, trace_id: "neat-trace", spans: 1 }), {
        status: 200,
      });
    },
  });

  await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "agent.run",
    name: "run",
  });
  const firstFlush = exporter.flush();
  await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "tool.call",
    name: "lookup",
  });
  releaseFirst?.();
  await firstFlush;
  await exporter.flush();

  assert.equal(requests.length, 2);
  await exporter.close();
});

test("agent observability: bounds Neatlogs export concurrency and buffering", async () => {
  const bus = createInMemoryEventBus();
  const requests: string[] = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  let releaseFirst: (() => void) | null = null;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const exporter = await createNeatlogsTraceExporter(bus, {
    writeKey: "nlw_test",
    maxInFlightTraces: 1,
    maxBufferedTraces: 2,
    fetchImpl: async (_input, init) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      requests.push(String(init?.body));
      if (requests.length === 1) await firstRequest;
      activeRequests -= 1;
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    },
  });

  for (const name of ["first", "second", "dropped"]) {
    await recordAgentTraceSpan(bus, {
      workspace_id: randomUUID(),
      trace_id: randomUUID(),
      kind: "tool.call",
      name,
    });
  }

  const flush = exporter.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  assert.equal(maxActiveRequests, 1);
  releaseFirst?.();
  await flush;
  assert.equal(requests.length, 2);
  await exporter.close();
});

test("agent observability: redacts sensitive attributes by default", async () => {
  const bus = createInMemoryEventBus();
  const span = await recordAgentTraceSpan(bus, {
    workspace_id: randomUUID(),
    kind: "tool.call",
    name: "product.outlook_account.connect_url.get",
    attributes: {
      message_body: "Hi Priya, saw your launch...",
      user_email: "priya@example.com",
      nested: {
        access_token: "secret-token",
        safe_count: 2,
      },
    },
  });

  assert.equal(span.redaction.pii, "redacted");
  assert.equal(span.redaction.raw_payload_exported, false);
  assert.equal(span.redaction.external_export_allowed, false);
  assert.equal(span.attributes.message_body, "[redacted]");
  assert.equal(span.attributes.user_email, "[redacted]");
  assert.deepEqual(span.attributes.nested, {
    access_token: "[redacted]",
    safe_count: 2,
  });
});

test("agent observability: blocks raw export when PII is present or redacted", async () => {
  const bus = createInMemoryEventBus();
  await assert.rejects(
    recordAgentTraceExported(bus, {
      workspace_id: randomUUID(),
      destination: "langfuse",
      trace_id: randomUUID(),
      span_count: 1,
      redaction: {
        pii: "redacted",
        raw_payload_exported: true,
        external_export_allowed: true,
      },
    }),
    AgentTraceRedactionError,
  );
});

test("agent observability: records redacted exports and trace-to-eval failures", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const span_id = randomUUID();

  const exported = await recordAgentTraceExported(bus, {
    workspace_id,
    destination: "phoenix",
    trace_id,
    span_count: 3,
    redaction: {
      pii: "redacted",
      raw_payload_exported: false,
      external_export_allowed: true,
    },
  });
  const failed = await recordAgentTraceEvalFailed(bus, {
    workspace_id,
    trace_id,
    span_id,
    failure_kind: "judge_regression",
    reason: "Draft cited an unsupported proof point.",
  });

  assert.equal(exported.destination, "phoenix");
  assert.equal(failed.trace_id, trace_id);
  assert.equal(bus.published.at(-2)?.event_type, "agent.trace.exported");
  assert.equal(bus.published.at(-1)?.event_type, "agent.trace.eval_failed");
});

test("agent observability: sanitizeTraceAttributes redacts nested values", () => {
  const result = sanitizeTraceAttributes({
    safe: "ok",
    phone_number: "+1 555 0101",
    nested: [{ refresh_token: "token" }],
  });

  assert.equal(result.redacted, true);
  assert.deepEqual(result.value, {
    safe: "ok",
    phone_number: "[redacted]",
    nested: [{ refresh_token: "[redacted]" }],
  });
});

test("agent observability: normalizes redacted trace exports for vendor sinks", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const first = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    span_id: randomUUID(),
    kind: "agent.run",
    name: "message.personalization_graph.v1",
    started_at: "2026-06-15T10:00:00.000Z",
    ended_at: "2026-06-15T10:00:01.000Z",
    attributes: { safe: "ok" },
  });
  const second = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    span_id: randomUUID(),
    parent_span_id: first.span_id,
    kind: "llm.call",
    name: "writer",
    model: "deepseek-v4-flash",
    prompt_tokens: 10,
    completion_tokens: 5,
    started_at: "2026-06-15T10:00:00.500Z",
    ended_at: "2026-06-15T10:00:00.800Z",
    attributes: { prompt_content: "contains private copy" },
  });

  const normalized = normalizeAgentTraceExport({
    workspace_id,
    trace_id,
    destination: "phoenix",
    spans: [second, first],
    external_export_allowed: true,
  });

  assert.equal(normalized.destination, "phoenix");
  assert.equal(normalized.span_count, 2);
  assert.equal(normalized.redaction.pii, "redacted");
  assert.equal(normalized.spans[0]?.span_id, first.span_id);
  assert.equal(normalized.spans[1]?.attributes.prompt_content, "[redacted]");
  assert.equal(normalized.spans[1]?.model, "deepseek-v4-flash");

  assert.throws(
    () => normalizeAgentTraceExport({
      workspace_id,
      trace_id,
      destination: "langfuse",
      spans: [second],
      external_export_allowed: true,
      raw_payload_exported: true,
    }),
    AgentTraceRedactionError,
  );
});

test("agent observability: promotes failed traces to eval candidates", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const signal_id = randomUUID();
  const ok = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "tool.call",
    name: "product.company_brain.recall",
    primitive_refs: { signal_id },
  });
  const failed = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "eval.judge",
    name: "hot-path-judge",
    status: "error",
    primitive_refs: { signal_id },
    attributes: { draft_body: "private draft copy" },
    error: { message: "Unsupported proof point." },
  });

  const candidate = promoteTraceToEvalCase({
    trace_id,
    spans: [ok, failed],
    failure_kind: "unsupported_proof",
    reason: "Judge caught a claim not grounded in evidence.",
  });

  assert.equal(candidate.trace_id, trace_id);
  assert.equal(candidate.source_span_id, failed.span_id);
  assert.equal(candidate.primitive_refs.signal_id, signal_id);
  assert.equal(candidate.spans.length, 2);
  assert.equal(candidate.spans[1]?.attributes.draft_body, "[redacted]");
});

test("agent observability: summarizes redacted traces for product visibility", async () => {
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const trace_id = randomUUID();
  const signal_id = randomUUID();
  const run = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    kind: "agent.run",
    name: "message.personalization_graph.v1",
    status: "ok",
    graph_name: "message.personalization_graph.v1",
    primitive_refs: { signal_id },
    started_at: "2026-06-15T10:00:00.000Z",
    ended_at: "2026-06-15T10:00:03.000Z",
    attributes: { safe: "yes" },
  });
  const judge = await recordAgentTraceSpan(bus, {
    workspace_id,
    trace_id,
    parent_span_id: run.span_id,
    kind: "eval.judge",
    name: "hot-path-judge",
    status: "error",
    model: "deepseek-v4-flash",
    prompt_tokens: 40,
    completion_tokens: 8,
    estimated_cost_usd: 0.000_012,
    primitive_refs: { signal_id },
    started_at: "2026-06-15T10:00:01.000Z",
    ended_at: "2026-06-15T10:00:02.000Z",
    attributes: { draft_body: "private draft" },
    error: { message: "Unsupported proof point." },
  });
  const exported = await recordAgentTraceExported(bus, {
    workspace_id,
    destination: "phoenix",
    trace_id,
    span_count: 2,
    redaction: {
      pii: "redacted",
      raw_payload_exported: false,
      external_export_allowed: true,
    },
  });
  const failed = await recordAgentTraceEvalFailed(bus, {
    workspace_id,
    trace_id,
    span_id: judge.span_id,
    failure_kind: "unsupported_proof",
    reason: "Judge caught an ungrounded claim.",
  });

  const summary = summarizeAgentTraceEvents(
    [
      {
        id: randomUUID(),
        event_type: "agent.trace.span.recorded",
        payload: run,
        occurred_at: "2026-06-15T10:00:00.000Z",
      },
      {
        id: randomUUID(),
        event_type: "agent.trace.span.recorded",
        payload: judge,
        occurred_at: "2026-06-15T10:00:02.000Z",
      },
      {
        id: randomUUID(),
        event_type: "agent.trace.exported",
        payload: exported,
        occurred_at: "2026-06-15T10:00:03.000Z",
      },
      {
        id: randomUUID(),
        event_type: "agent.trace.eval_failed",
        payload: failed,
        occurred_at: "2026-06-15T10:00:04.000Z",
      },
    ],
    {
      workspace_id,
      lookback_hours: 24,
      now: new Date("2026-06-15T10:05:00.000Z"),
    },
  );

  assert.equal(summary.trace_count, 1);
  assert.equal(summary.span_count, 2);
  assert.equal(summary.error_span_count, 1);
  assert.equal(summary.eval_failure_count, 1);
  assert.equal(summary.total_prompt_tokens, 40);
  assert.equal(summary.estimated_cost_usd, 0.000_012);
  assert.equal(summary.redaction.pii_redacted_trace_count, 1);
  assert.deepEqual(summary.traces[0]?.export_destinations, ["phoenix"]);
  assert.equal(summary.traces[0]?.primitive_refs.signal_id, signal_id);
  assert.equal(summary.traces[0]?.latest_error?.message, "Unsupported proof point.");
  assert.equal(summary.traces[0]?.spans[1]?.attributes.draft_body, "[redacted]");
});

test("agent observability: product summary reads typed events from Postgres", async (t) => {
  const fx = await setupPg("agent_observability_summary");
  if (!fx) {
    t.skip("DATABASE_URL not set");
    return;
  }
  t.after(async () => {
    await fx.close();
  });

  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const trace_id = randomUUID();
  await fx.pool.query(
    `insert into workspaces (id, slug, name, settings)
     values ($1, $2, 'Trace workspace', '{}'::jsonb)`,
    [workspace_id, `trace-${workspace_id}`],
  );

  await appendPostgresEvent(fx.pool, {
    workspace_id,
    event_type: "agent.trace.span.recorded",
    source: "system",
    producer_ref: "test",
    payload: {
      span_id: randomUUID(),
      trace_id,
      parent_span_id: null,
      kind: "llm.call",
      name: "writer",
      status: "ok",
      started_at: "2026-06-15T10:00:00.000Z",
      ended_at: "2026-06-15T10:00:01.000Z",
      duration_ms: 1000,
      graph_name: "message.personalization_graph.v1",
      node_name: "writer",
      run_id: "run-1",
      thread_id: "thread-1",
      primitive_refs: {},
      model: "deepseek-v4-flash",
      prompt_tokens: 12,
      completion_tokens: 4,
      estimated_cost_usd: 0.000_003,
      retry_count: 0,
      attributes: { safe: "ok" },
      redaction: {
        pii: "none",
        raw_payload_exported: false,
        external_export_allowed: false,
      },
      error: null,
    },
    occurred_at: new Date().toISOString(),
  });

  const summary = await getWorkspaceAgentObservabilitySummary(
    { trace_id, lookback_hours: 1 },
    verifiedProductWorkspaceSession({ workspace_id, user_id }),
    fx.pool,
  );

  assert.equal(summary.trace_count, 1);
  assert.equal(summary.traces[0]?.trace_id, trace_id);
  assert.equal(summary.traces[0]?.model_names[0], "deepseek-v4-flash");
});
