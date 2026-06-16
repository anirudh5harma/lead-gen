import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runVerticalIntelligenceGraphInWorkflowStep,
  type BombsellLangGraphState,
  type VerticalIntelligenceDecision,
  type VerticalIntelligenceGraphInput,
} from "../core/agents/langgraph/index.ts";
import {
  _resetToolRegistry,
  registerTool,
} from "../core/agents/tools/registry.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import { defineWorkflow } from "../core/substrate/workflows/define.ts";
import { createInProcessWorkflowRuntime } from "../core/substrate/workflows/index.ts";

async function until<T>(
  predicate: () => T | Promise<T> | undefined | null | false,
  { timeout = 2000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (true) {
    const value = await predicate();
    if (value) return value as T;
    if (Date.now() > deadline) throw new Error("until: timeout");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

test("vertical intelligence graph refreshes graph memory without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const company_id = randomUUID();
  const evidence_source_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.vertical_intelligence.refresh",
    description: "Refresh vertical intelligence.",
    kind: "write",
    input: z.object({
      company_id: z.string().uuid().nullable().optional(),
    }),
    output: verticalIntelligenceOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.vertical_intelligence.refresh");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.equal(input.company_id, company_id);
      const pack = {
        workspace_id,
        company_id,
        company_name: "Acme GTM",
        vertical: "AI GTM",
        generated_at: "2026-06-15T10:00:00.000Z",
        graph_name: "vertical.intelligence_graph.v1",
        run_id: "vertical-test-run",
        confidence: 0.84,
        facts: [{
          id: "vertical_fact:proof:test",
          category: "proof" as const,
          statement: "Customers use Acme to catch funding timing signals.",
          confidence: 0.84,
          tags: ["proof"],
          source_refs: [{
            type: "evidence_source",
            id: evidence_source_id,
            label: "Profile evidence",
          }],
          primitive_refs: { company_id },
          last_observed_at: "2026-06-15T09:00:00.000Z",
          included_in_prompt: true,
        }],
        prompt_context:
          "- Vertical: AI GTM confidence=0.84\n- [proof] Customers use Acme to catch funding timing signals. confidence=0.84 refs=1 tags=proof",
        evidence_source_ids: [evidence_source_id],
        redaction_status: "source_refs_only" as const,
      };
      await bus.publish({
        workspace_id,
        event_type: "vertical.intelligence.updated",
        source: "system",
        producer_ref: "test:product.vertical_intelligence.refresh",
        idempotency_key: `vertical-intelligence-test:${company_id}`,
        payload: {
          company_id: pack.company_id,
          company_name: pack.company_name,
          vertical: pack.vertical,
          generated_at: pack.generated_at,
          graph_name: pack.graph_name,
          run_id: pack.run_id,
          confidence: pack.confidence,
          facts: pack.facts,
          prompt_context: pack.prompt_context,
          evidence_source_ids: pack.evidence_source_ids,
          redaction_status: pack.redaction_status,
        },
      });
      return pack;
    },
  });

  runtime.register(
    defineWorkflow<VerticalIntelligenceGraphInput, BombsellLangGraphState>({
      name: "vertical_intelligence_graph_test",
      version: "1",
      async run(input, ctx) {
        return runVerticalIntelligenceGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "vertical_intelligence_graph_test",
    input: {
      workspace_id,
      user_id,
      company_id,
    },
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<VerticalIntelligenceGraphInput, BombsellLangGraphState>(
    run.id,
  );
  const decision = final?.output?.attributes
    ?.vertical_intelligence as VerticalIntelligenceDecision;

  assert.equal(decision.company_id, company_id);
  assert.equal(decision.vertical, "AI GTM");
  assert.equal(decision.fact_count, 1);
  assert.equal(decision.prompt_fact_count, 1);
  assert.equal(decision.source_ref_count, 1);
  assert.equal(decision.next_action, "use_vertical_context");
  assert.deepEqual(toolCalls, ["product.vertical_intelligence.refresh"]);

  const updateEvent = bus.published.find(
    (event) => event.event_type === "vertical.intelligence.updated",
  );
  assert.ok(updateEvent, "expected vertical.intelligence.updated event");
  assert.equal(updateEvent.payload.company_id, company_id);

  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "vertical intelligence graph must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
  assert.equal(spanKinds.has("memory.write"), true);
});

const primitiveRefsSchema = z.object({
  rep_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  play_id: z.string().uuid().nullable().optional(),
  play_run_id: z.string().uuid().nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
  icp_id: z.string().uuid().nullable().optional(),
});

const verticalIntelligenceOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  company_id: z.string().uuid(),
  company_name: z.string().min(1),
  vertical: z.string().min(1),
  generated_at: z.string().datetime(),
  graph_name: z.string().min(1),
  run_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  facts: z.array(z.object({
    id: z.string().min(1),
    category: z.enum([
      "icp_rule",
      "pain",
      "objection",
      "proof",
      "competitor",
      "trigger",
      "positioning",
      "signal_mapping",
      "skill_performance",
    ]),
    statement: z.string().min(1),
    confidence: z.number().min(0).max(1),
    tags: z.array(z.string().min(1)),
    source_refs: z.array(z.object({
      type: z.string().min(1),
      id: z.string().min(1),
      label: z.string().min(1),
      url: z.string().url().nullable().optional(),
    })),
    primitive_refs: primitiveRefsSchema,
    last_observed_at: z.string().datetime(),
    included_in_prompt: z.boolean(),
  })),
  prompt_context: z.string(),
  evidence_source_ids: z.array(z.string().uuid()),
  redaction_status: z.literal("source_refs_only"),
});
