import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runReplyTriageGraphInWorkflowStep,
  type BombsellLangGraphState,
  type ReplyTriageDecision,
  type ReplyTriageGraphInput,
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

test("reply triage graph classifies inbound replies without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const conversation_id = randomUUID();
  const inbound_message_id = randomUUID();
  const outcome_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.reply.triage",
    description: "Triage a reply.",
    kind: "write",
    input: z.object({
      channel: z.literal("email").optional(),
      external_id: z.string(),
      external_thread_id: z.string().optional(),
      in_reply_to: z.string().optional(),
      references: z.array(z.string()).optional(),
      from_email: z.string().email(),
      from_name: z.string().optional(),
      subject: z.string(),
      body_text: z.string(),
      body_html: z.string().optional(),
      received_at: z.string().datetime(),
      channel_account_id: z.string().uuid().optional(),
      ingress_event_id: z.string().uuid().optional(),
    }),
    output: replyTriageOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.reply.triage");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.equal(input.external_id, "msg_reply_1");
      assert.equal(input.from_email, "priya@acme.example");
      assert.equal(input.subject, "Re: outbound hiring");
      assert.match(input.body_text, /chat next week/);
      await bus.publish({
        workspace_id,
        event_type: "reply.classified",
        source: "system",
        producer_ref: "test:reply-triage",
        payload: {
          conversation_id,
          message_id: inbound_message_id,
          intent: "positive",
          confidence: 0.91,
          reason: "Asked to chat next week.",
          received_at: input.received_at,
        },
      });
      await bus.publish({
        workspace_id,
        event_type: "outcome.recorded",
        source: "system",
        producer_ref: "test:reply-triage",
        payload: {
          outcome_id,
          kind: "positive_reply",
          score: 1,
          conversation_id,
          attributed_play_id: null,
          attributed_message_id: null,
          attributed_signal_id: null,
          attributed_rep_id: null,
          properties: {
            reply_message_id: inbound_message_id,
            reply_intent: "positive",
          },
          provenance: {
            graph_name: "reply.triage_graph.v1",
          },
          occurred_at: input.received_at,
        },
      });
      return {
        workspace_id,
        channel: "email",
        matched_conversation_id: conversation_id,
        inbound_message_id,
        intent: "positive",
        intent_confidence: 0.91,
        outcome_id,
        next_action: "generate_meeting_prep" as const,
      };
    },
  });

  runtime.register(
    defineWorkflow<ReplyTriageGraphInput, BombsellLangGraphState>({
      name: "reply_triage_graph_test",
      version: "1",
      async run(input, ctx) {
        return runReplyTriageGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "reply_triage_graph_test",
    input: {
      workspace_id,
      user_id,
      external_id: "msg_reply_1",
      external_thread_id: "thread_1",
      in_reply_to: "<outbound@example>",
      references: ["<outbound@example>"],
      from_email: "priya@acme.example",
      from_name: "Priya",
      subject: "Re: outbound hiring",
      body_text: "Sure, happy to chat next week.",
      received_at: "2026-06-16T10:00:00.000Z",
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<ReplyTriageGraphInput, BombsellLangGraphState>(
    run.id,
  );
  const decision = final?.output?.attributes?.reply_triage as ReplyTriageDecision;

  assert.equal(decision.matched_conversation_id, conversation_id);
  assert.equal(decision.inbound_message_id, inbound_message_id);
  assert.equal(decision.intent, "positive");
  assert.equal(decision.outcome_id, outcome_id);
  assert.equal(decision.next_action, "generate_meeting_prep");
  assert.equal(decision.should_record_meeting_prep, true);
  assert.equal(decision.should_draft_reply, true);
  assert.deepEqual(toolCalls, ["product.reply.triage"]);

  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "reply triage graph must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
});

const replyTriageOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  channel: z.literal("email"),
  matched_conversation_id: z.string().uuid().nullable(),
  inbound_message_id: z.string().uuid().nullable(),
  intent: z.enum([
    "positive",
    "meeting_intent",
    "negative",
    "neutral",
    "ooo",
    "unsubscribe",
    "do_not_contact",
    "spam",
  ]).nullable(),
  intent_confidence: z.number().min(0).max(1).nullable(),
  outcome_id: z.string().uuid().nullable(),
  next_action: z.enum([
    "generate_meeting_prep",
    "draft_reply",
    "block_contact",
    "stop",
    "review_unmatched",
  ]),
});
