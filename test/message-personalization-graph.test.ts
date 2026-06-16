import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runMessagePersonalizationGraphInWorkflowStep,
  type BombsellLangGraphState,
  type MessagePersonalizationDecision,
  type MessagePersonalizationGraphInput,
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

test("message personalization graph drafts from product tool without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const rep_id = randomUUID();
  const signal_id = randomUUID();
  const person_id = randomUUID();
  const company_id = randomUUID();
  const play_id = randomUUID();
  const play_run_id = randomUUID();
  const conversation_id = randomUUID();
  const message_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.message.personalize",
    description: "Personalize a message.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      signal_id: z.string().uuid(),
      person_id: z.string().uuid(),
      company_id: z.string().uuid().optional(),
      channel: z.string().optional(),
      stage: z.string().optional(),
      play_id: z.string().uuid().optional(),
      play_run_id: z.string().uuid().optional(),
      conversation_id: z.string().uuid().optional(),
      message_id: z.string().uuid().optional(),
      use_llm: z.boolean().optional(),
    }),
    output: messagePersonalizationOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.message.personalize");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.equal(input.rep_id, rep_id);
      assert.equal(input.signal_id, signal_id);
      assert.equal(input.person_id, person_id);
      assert.equal(input.company_id, company_id);
      assert.equal(input.channel, "email");
      assert.equal(input.stage, "cold_open");
      assert.equal(input.play_id, play_id);
      assert.equal(input.play_run_id, play_run_id);
      assert.equal(input.conversation_id, conversation_id);
      await bus.publish({
        workspace_id,
        event_type: "message.personalized",
        source: "agent",
        producer_ref: `rep:${rep_id}`,
        payload: {
          conversation_id,
          message_id,
          channel: "email",
          rep_id,
          play_id,
          play_run_id,
          signal_id,
          person_id,
          company_id,
          subject: "Quick question on hiring signal",
          body: "Hi Priya,\n\nNoticed Acme is hiring outbound leaders...",
          personalization_context_markdown: "## Signal Timing And Why Now\n- Acme is hiring outbound leaders",
          skill: {
            skill_key: "signal_problem_probe",
            version: "v1",
          },
          provenance: {
            graph_name: "message.personalization_graph.v1",
            pattern_key: "icp:ai-gtm|signal:hiring|stage:cold_open|skill:signal_problem_probe@v1",
          },
          personalized_at: "2026-06-15T10:00:00.000Z",
        },
      });
      return {
        workspace_id,
        conversation_id,
        message_id,
        channel: "email",
        rep_id,
        signal_id,
        person_id,
        company_id,
        subject: "Quick question on hiring signal",
        body: "Hi Priya,\n\nNoticed Acme is hiring outbound leaders...",
        pattern_key: "icp:ai-gtm|signal:hiring|stage:cold_open|skill:signal_problem_probe@v1",
        seed_pattern_key: null,
        skill_key: "signal_problem_probe",
        skill_version: "v1",
        exemplar_ids: ["exemplar_1"],
        procedural_exemplar_count: 1,
        personalization_context_markdown: "## Signal Timing And Why Now\n- Acme is hiring outbound leaders",
        provenance: {
          graph_name: "message.personalization_graph.v1",
          pattern_key: "icp:ai-gtm|signal:hiring|stage:cold_open|skill:signal_problem_probe@v1",
        },
        llm_used: false,
        next_action: "run_eval_gate" as const,
      };
    },
  });

  runtime.register(
    defineWorkflow<MessagePersonalizationGraphInput, BombsellLangGraphState>({
      name: "message_personalization_graph_test",
      version: "1",
      async run(input, ctx) {
        return runMessagePersonalizationGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "message_personalization_graph_test",
    input: {
      workspace_id,
      user_id,
      rep_id,
      signal_id,
      person_id,
      company_id,
      channel: "email",
      stage: "cold_open",
      play_id,
      play_run_id,
      conversation_id,
      use_llm: false,
    },
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<MessagePersonalizationGraphInput, BombsellLangGraphState>(
    run.id,
  );
  const decision = final?.output?.attributes
    ?.message_personalization as MessagePersonalizationDecision;

  assert.equal(decision.message_id, message_id);
  assert.equal(decision.channel, "email");
  assert.equal(decision.skill_key, "signal_problem_probe");
  assert.equal(decision.exemplar_count, 1);
  assert.equal(decision.next_action, "run_eval_gate");
  assert.deepEqual(toolCalls, ["product.message.personalize"]);

  const personalized = bus.published.find(
    (event) => event.event_type === "message.personalized",
  );
  assert.ok(personalized, "expected message.personalized event");
  assert.equal(personalized.payload.message_id, message_id);
  assert.equal(personalized.payload.signal_id, signal_id);

  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "message personalization graph must not enqueue or send outreach",
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

const messagePersonalizationOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable(),
  message_id: z.string().uuid(),
  channel: z.string(),
  rep_id: z.string().uuid(),
  signal_id: z.string().uuid(),
  person_id: z.string().uuid(),
  company_id: z.string().uuid().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  pattern_key: z.string(),
  seed_pattern_key: z.string().nullable(),
  skill_key: z.string(),
  skill_version: z.string(),
  exemplar_ids: z.array(z.string()),
  procedural_exemplar_count: z.number().int().nonnegative(),
  personalization_context_markdown: z.string(),
  provenance: z.record(z.string(), z.unknown()),
  llm_used: z.boolean(),
  next_action: z.literal("run_eval_gate"),
});
