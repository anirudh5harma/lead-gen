import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runContactWaterfallGraphInWorkflowStep,
  type BombsellLangGraphState,
  type ContactWaterfallDecision,
  type ContactWaterfallGraphInput,
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

test("contact waterfall graph: resolves contacts through the product tool without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const company_id = randomUUID();
  const play_id = randomUUID();
  const rep_id = randomUUID();
  const person_id = randomUUID();
  const workflow_run_id = randomUUID();
  const contact_resolution_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.contact.waterfall.resolve",
    description: "Resolve contacts.",
    kind: "write",
    input: z.object({
      signal_id: z.string().uuid(),
      company_id: z.string().uuid(),
      play_id: z.string().uuid(),
      rep_id: z.string().uuid(),
      channel: z.enum(["email", "linkedin"]),
      limit: z.number().int().min(1).max(3).optional(),
      repair_key: z.string().nullable().optional(),
      wait: z.boolean().optional(),
      timeout_ms: z.number().int().positive().optional(),
    }),
    output: contactWaterfallOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.contact.waterfall.resolve");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.deepEqual(input, {
        signal_id,
        company_id,
        play_id,
        rep_id,
        channel: "email",
        limit: 2,
        repair_key: null,
        wait: true,
        timeout_ms: 30000,
      });
      return {
        workspace_id,
        workflow_name: "contact.resolve_for_signal.v1" as const,
        workflow_run_id,
        workflow_status: "completed" as const,
        decision: "resolved" as const,
        contact_resolution_id,
        selected_person_id: person_id,
        defer_reason: null,
        candidates: [{
          person_id,
          full_name: "Avery Founder",
          title: "Founder",
          company_id,
          emails: ["avery@example.com"],
          linkedin_url: "https://linkedin.com/in/avery-founder",
          score: 0.92,
          reasons: ["executive_or_founder", "verified_email"],
          verification: {
            email_status: "valid",
            email_verified: true,
            linkedin_ready: true,
          },
          provenance: { source: "graph_cache" },
        }],
      };
    },
  });

  runtime.register(
    defineWorkflow<ContactWaterfallGraphInput, BombsellLangGraphState>({
      name: "contact_waterfall_graph_test",
      version: "1",
      async run(input, ctx) {
        return runContactWaterfallGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "contact_waterfall_graph_test",
    input: {
      workspace_id,
      user_id,
      signal_id,
      company_id,
      play_id,
      rep_id,
      channel: "email",
      limit: 2,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<ContactWaterfallGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");
  const decision = output.attributes?.contact_waterfall as ContactWaterfallDecision;
  assert.equal(decision.decision, "resolved");
  assert.equal(decision.next_action, "continue_to_play");
  assert.equal(decision.selected_person_id, person_id);
  assert.equal(decision.candidate_count, 1);
  assert.equal(decision.top_candidate?.full_name, "Avery Founder");
  assert.deepEqual(toolCalls, ["product.contact.waterfall.resolve"]);
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "contact waterfall graph must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
  assert.equal(spanKinds.has("contact.waterfall.step"), true);
});

const contactWaterfallOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  workflow_name: z.literal("contact.resolve_for_signal.v1"),
  workflow_run_id: z.string().min(1),
  workflow_status: z.enum([
    "pending",
    "running",
    "awaiting_approval",
    "awaiting_event",
    "completed",
    "failed",
    "cancelled",
  ]),
  decision: z.enum(["started", "resolved", "deferred"]),
  contact_resolution_id: z.string().uuid().nullable(),
  selected_person_id: z.string().uuid().nullable(),
  defer_reason: z.string().nullable(),
  candidates: z.array(z.object({
    person_id: z.string().uuid(),
    full_name: z.string(),
    title: z.string().nullable(),
    company_id: z.string().uuid().nullable(),
    emails: z.array(z.string()),
    linkedin_url: z.string().nullable(),
    score: z.number(),
    reasons: z.array(z.string()),
    verification: z.object({
      email_status: z.string().nullable().optional(),
      email_verified: z.boolean().optional(),
      linkedin_ready: z.boolean().optional(),
    }),
    provenance: z.record(z.string(), z.unknown()),
  })),
});
