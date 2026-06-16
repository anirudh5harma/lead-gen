import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runCompanyBrainBriefGraphInWorkflowStep,
  runCompanyBrainRecallGraphInWorkflowStep,
  type BombsellLangGraphState,
  type CompanyBrainBriefDecision,
  type CompanyBrainGraphInput,
  type CompanyBrainRecallDecision,
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

test("company brain graphs recall and refresh shared memory without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const conversation_id = randomUUID();
  const message_id = randomUUID();
  const meeting_prep_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.company_brain.recall",
    description: "Recall shared company brain.",
    kind: "read",
    input: z.object({}),
    output: companyBrainOutputSchema,
    async handler(_input, ctx) {
      toolCalls.push("product.company_brain.recall");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      return {
        workspace_id,
        generated_at: "2026-06-15T10:00:00.000Z",
        connector: {
          memory_store: {
            enabled: false,
            status: "disabled" as const,
            detail: "Optional Memory Store connector is disabled.",
          },
        },
        cards: [{
          id: `signal:${signal_id}`,
          kind: "signal" as const,
          title: "Target account is hiring RevOps",
          summary: "Hiring suggests a GTM workflow change.",
          confidence: 0.91,
          freshness_at: "2026-06-15T08:00:00.000Z",
          tags: ["signal", "hiring"],
          primitive_refs: { signal_id },
          source_refs: [{
            type: "signal",
            id: signal_id,
            label: "Signal",
            url: "https://example.com/jobs/revops",
          }],
        }, {
          id: `meeting_prep:${meeting_prep_id}`,
          kind: "meeting_prep" as const,
          title: "Meeting prep for Maya at Acme",
          summary: "Maya is ready for a focused follow-up on the RevOps hiring signal.",
          confidence: 0.82,
          freshness_at: "2026-06-15T09:30:00.000Z",
          tags: ["meeting_prep", "ready", "ask_for_times"],
          primitive_refs: {
            signal_id,
            conversation_id,
            message_id,
            person_id: null,
            company_id: null,
            outcome_id: null,
            rep_id: null,
          },
          source_refs: [{
            type: "meeting_prep",
            id: meeting_prep_id,
            label: "Meeting prep note",
          }, {
            type: "conversation",
            id: conversation_id,
            label: "Conversation",
          }, {
            type: "message",
            id: message_id,
            label: "Latest inbound reply",
          }],
        }],
      };
    },
  });

  runtime.register(
    defineWorkflow<CompanyBrainGraphInput, BombsellLangGraphState>({
      name: "company_brain_recall_graph_test",
      version: "1",
      async run(input, ctx) {
        return runCompanyBrainRecallGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );
  runtime.register(
    defineWorkflow<CompanyBrainGraphInput, BombsellLangGraphState>({
      name: "company_brain_brief_graph_test",
      version: "1",
      async run(input, ctx) {
        return runCompanyBrainBriefGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const recallRun = await runtime.start({
    workspace_id,
    workflow_name: "company_brain_recall_graph_test",
    input: {
      workspace_id,
      user_id,
      signal_id,
      brief_type: "account",
      task: "Recall context for meeting prep.",
    },
  });
  await until(async () => (await runtime.get(recallRun.id))?.status === "completed");
  const recallFinal = await runtime.get<CompanyBrainGraphInput, BombsellLangGraphState>(
    recallRun.id,
  );
  const recall = recallFinal?.output?.attributes
    ?.company_brain_recall as CompanyBrainRecallDecision;
  assert.equal(recall.card_count, 2);
  assert.equal(recall.source_ref_count, 4);
  assert.equal(recall.brief_type, "account");
  assert.equal(recall.next_action, "use_context");
  assert.equal(recall.cards[0]?.primitive_refs.signal_id, signal_id);
  assert.equal(
    recall.cards.some((card) =>
      card.kind === "meeting_prep" &&
      card.primitive_refs.conversation_id === conversation_id &&
      card.primitive_refs.message_id === message_id
    ),
    true,
  );

  const recallEvent = bus.published.find(
    (event) => event.event_type === "company.memory.recalled",
  );
  assert.ok(recallEvent, "expected company.memory.recalled event");
  assert.equal(recallEvent.payload.card_count, 2);
  assert.equal(recallEvent.payload.primitive_refs.signal_id, signal_id);

  const briefRun = await runtime.start({
    workspace_id,
    workflow_name: "company_brain_brief_graph_test",
    input: {
      workspace_id,
      user_id,
      signal_id,
      brief_type: "objection_bank",
      task: "Refresh objection handling context.",
    },
  });
  await until(async () => (await runtime.get(briefRun.id))?.status === "completed");
  const briefFinal = await runtime.get<CompanyBrainGraphInput, BombsellLangGraphState>(
    briefRun.id,
  );
  const brief = briefFinal?.output?.attributes
    ?.company_brain_brief as CompanyBrainBriefDecision;
  assert.equal(brief.brief_type, "objection_bank");
  assert.match(brief.brief_id, /^objection_bank:/);
  assert.match(brief.markdown, /Target account is hiring RevOps/);
  assert.match(brief.markdown, /focused follow-up on the RevOps hiring signal/);

  const briefEvent = bus.published.find(
    (event) => event.event_type === "company.brief.updated",
  );
  assert.ok(briefEvent, "expected company.brief.updated event");
  assert.equal(briefEvent.payload.brief_type, "objection_bank");
  assert.match(briefEvent.payload.markdown, /Memory Store connector disabled/);

  assert.deepEqual(toolCalls, [
    "product.company_brain.recall",
    "product.company_brain.recall",
  ]);
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "company brain graphs must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);
  assert.equal(spanKinds.has("memory.read"), true);
  assert.equal(spanKinds.has("memory.write"), true);
});

const primitiveRefsSchema = z.object({
  rep_id: z.string().uuid().nullable().optional(),
  signal_id: z.string().uuid().nullable().optional(),
  conversation_id: z.string().uuid().nullable().optional(),
  message_id: z.string().uuid().nullable().optional(),
  outcome_id: z.string().uuid().nullable().optional(),
  company_id: z.string().uuid().nullable().optional(),
  person_id: z.string().uuid().nullable().optional(),
});

const companyBrainOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  generated_at: z.string().datetime(),
  connector: z.object({
    memory_store: z.object({
      enabled: z.boolean(),
      status: z.enum(["disabled", "configured"]),
      detail: z.string(),
    }),
  }),
  cards: z.array(z.object({
    id: z.string(),
    kind: z.enum(["profile", "signal", "outcome", "playbook", "semantic_fact", "meeting_prep"]),
    title: z.string(),
    summary: z.string(),
    confidence: z.number().nullable(),
    freshness_at: z.string().datetime().nullable(),
    tags: z.array(z.string()),
    primitive_refs: primitiveRefsSchema,
    source_refs: z.array(z.object({
      type: z.string(),
      id: z.string(),
      label: z.string(),
      url: z.string().url().nullable().optional(),
    })).min(1),
  })),
});
