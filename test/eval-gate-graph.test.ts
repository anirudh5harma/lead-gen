import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runEvalGateGraphInWorkflowStep,
  type BombsellLangGraphState,
  type EvalGateDecision,
  type EvalGateGraphInput,
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

test("eval gate graph: judges drafts and rejects without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const rep_id = randomUUID();
  const message_id = randomUUID();
  const judged_event_id = randomUUID();
  const rejected_event_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.draft.eval.gate",
    description: "Run eval gate.",
    kind: "write",
    input: draftEvalInputSchema,
    output: draftEvalOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.draft.eval.gate");
      assert.equal(input.message_id, message_id);
      assert.equal(input.rep_id, rep_id);
      assert.equal(input.channel, "email");
      assert.match(input.body, /AI language model/);
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      await bus.publish({
        workspace_id,
        event_type: "draft.judged",
        source: "agent",
        producer_ref: "test:eval-gate",
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        idempotency_key: `test:draft.judged:${message_id}`,
        payload: {
          message_id,
          eval_score: 0.2,
          passed: false,
          notes: {
            critique: "Draft claims the sender is an AI assistant.",
            axes: { brand_voice: 0 },
          },
        },
      });
      await bus.publish({
        workspace_id,
        event_type: "draft.rejected",
        source: "agent",
        producer_ref: "test:eval-gate",
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        idempotency_key: `test:draft.rejected:${message_id}`,
        payload: {
          message_id,
          reason: "Draft claims the sender is an AI assistant.",
        },
      });
      return {
        workspace_id,
        message_id,
        rep_id,
        channel: "email",
        decision: "reject" as const,
        eval_score: 0.2,
        threshold: 0.6,
        passed: false,
        notes: {
          critique: "Draft claims the sender is an AI assistant.",
          axes: { brand_voice: 0 },
        },
        judged_event_id,
        rejected_event_id,
        rejection_reason: "Draft claims the sender is an AI assistant.",
        next_action: "revise_draft" as const,
      };
    },
  });

  runtime.register(
    defineWorkflow<EvalGateGraphInput, BombsellLangGraphState>({
      name: "eval_gate_graph_test",
      version: "1",
      async run(input, ctx) {
        return runEvalGateGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "eval_gate_graph_test",
    input: {
      workspace_id,
      user_id,
      rep_id,
      message_id,
      channel: "email",
      subject: "Saw your launch",
      body: "Hi Anne, as an AI language model I noticed your launch.",
      personalization_context_markdown: "Signal: launch timing",
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<EvalGateGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");

  const decision = output.attributes?.eval_gate as EvalGateDecision;
  assert.equal(decision.message_id, message_id);
  assert.equal(decision.decision, "reject");
  assert.equal(decision.next_action, "revise_draft");
  assert.equal(decision.passed, false);

  assert.deepEqual(toolCalls, ["product.draft.eval.gate"]);
  assert.equal(
    bus.published.some((event) => event.event_type === "draft.judged"),
    true,
  );
  assert.equal(
    bus.published.some((event) => event.event_type === "draft.rejected"),
    true,
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "eval gate graph must not enqueue or send outreach",
  );
});

const draftEvalInputSchema = z.object({
  message_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  channel: z.string(),
  subject: z.string().nullable().optional(),
  body: z.string(),
  artifact_kind: z.enum(["draft", "plan", "post", "reply", "other"]).optional(),
  signal_summary: z.string().nullable().optional(),
  counterparty_summary: z.string().nullable().optional(),
  personalization_context_markdown: z.string().nullable().optional(),
  workspace_context_markdown: z.string().nullable().optional(),
  outreach_skill: z.unknown().optional(),
});

const draftEvalOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  message_id: z.string().uuid(),
  rep_id: z.string().uuid(),
  channel: z.string(),
  decision: z.enum(["pass", "reject"]),
  eval_score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  passed: z.boolean(),
  notes: z.record(z.string(), z.unknown()),
  judged_event_id: z.string().uuid(),
  rejected_event_id: z.string().uuid().nullable(),
  rejection_reason: z.string().nullable(),
  next_action: z.enum(["continue_to_play_gate", "revise_draft"]),
});
