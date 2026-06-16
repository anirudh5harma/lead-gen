import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runOutreachSkillSelectionGraphInWorkflowStep,
  type BombsellLangGraphState,
  type OutreachSkillSelectionDecision,
  type OutreachSkillSelectionGraphInput,
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

test("outreach skill selection graph selects a skill without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.play.skills.select",
    description: "Select an outreach skill.",
    kind: "read",
    input: z.object({
      channel: z.string(),
      stage: z.string(),
      signal_kind: z.string().optional(),
      intent: z.string().optional(),
      action: z.string().optional(),
      person_title: z.string().nullable().optional(),
      base_pattern_key: z.string().optional(),
      slot_values: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      skill: z.object({
        skill_key: z.string(),
        version: z.string(),
        channel: z.string(),
        stage: z.string(),
        name: z.string(),
        description: z.string(),
        pattern_key: z.string(),
        framework: z.array(z.string()),
        slot_values: z.record(z.string(), z.string()),
        constraints: z.array(z.string()),
        judge_focus: z.array(z.string()),
      }),
    }),
    async handler(input, ctx) {
      toolCalls.push("product.play.skills.select");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.equal(input.channel, "email");
      assert.equal(input.stage, "cold_open");
      assert.equal(input.signal_kind, "funding");
      assert.equal(input.base_pattern_key, "icp:fintech-founder|signal:funding|stage:cold_open");
      return {
        workspace_id,
        skill: {
          skill_key: "signal_problem_probe",
          version: "v1",
          channel: "email",
          stage: "cold_open",
          name: "Signal Problem Probe",
          description: "Signal to problem to reply question.",
          pattern_key: `${input.base_pattern_key}|skill:signal_problem_probe@v1`,
          framework: ["Open with the signal.", "Ask one concrete question."],
          slot_values: {
            signal_hook: String(input.slot_values?.signal_hook ?? ""),
          },
          constraints: ["No generic opener."],
          judge_focus: ["Signal is named early."],
        },
      };
    },
  });

  runtime.register(
    defineWorkflow<OutreachSkillSelectionGraphInput, BombsellLangGraphState>({
      name: "outreach_skill_selection_graph_test",
      version: "1",
      async run(input, ctx) {
        return runOutreachSkillSelectionGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "outreach_skill_selection_graph_test",
    input: {
      workspace_id,
      user_id,
      channel: "email",
      stage: "cold_open",
      signal_kind: "funding",
      base_pattern_key: "icp:fintech-founder|signal:funding|stage:cold_open",
      slot_values: {
        signal_hook: "Acme raised a Series A",
      },
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<OutreachSkillSelectionGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");
  const decision = output.attributes?.outreach_skill_decision as OutreachSkillSelectionDecision;
  assert.equal(decision.skill_key, "signal_problem_probe");
  assert.equal(decision.next_action, "compose_email");
  assert.match(decision.pattern_key, /skill:signal_problem_probe@v1/);
  assert.deepEqual(toolCalls, ["product.play.skills.select"]);
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "skill selection must not enqueue or send outreach",
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
