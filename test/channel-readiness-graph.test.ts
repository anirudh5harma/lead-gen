import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runChannelReadinessGraphInWorkflowStep,
  type BombsellLangGraphState,
  type ChannelReadinessDecision,
  type ChannelReadinessGraphInput,
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

test("channel readiness graph: checks launch blockers without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.launch.readiness.get",
    description: "Read launch readiness.",
    kind: "read",
    input: z.object({
      required_channel: z.enum(["any", "email", "linkedin", "both"]).optional(),
    }),
    output: channelReadinessOutputSchema,
    async handler(input, ctx) {
      toolCalls.push("product.launch.readiness.get");
      assert.equal(input.required_channel, "both");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      return {
        workspace_id,
        checked_at: "2026-06-15T10:00:00.000Z",
        required_channel: "both" as const,
        status: "blocked" as const,
        launch_ready: false,
        next_action: "connect_linkedin" as const,
        checks: [
          {
            id: "outlook",
            label: "Outlook",
            primitive: "Conversation" as const,
            status: "ready" as const,
            required: true,
            detail: "1/1 Outlook inboxes have active reply sync.",
            count: 1,
            action: null,
          },
          {
            id: "linkedin",
            label: "LinkedIn",
            primitive: "Conversation" as const,
            status: "blocked" as const,
            required: true,
            detail: "No connected LinkedIn account is ready.",
            count: 0,
            action: {
              label: "Connect LinkedIn",
              tools: ["product.linkedin_account.connect_url.get"],
              surface: "/dashboard/setup",
            },
          },
        ],
        blockers: ["linkedin", "outreach_channel"],
        warnings: [],
      };
    },
  });

  runtime.register(
    defineWorkflow<ChannelReadinessGraphInput, BombsellLangGraphState>({
      name: "channel_readiness_graph_test",
      version: "1",
      async run(input, ctx) {
        return runChannelReadinessGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "channel_readiness_graph_test",
    input: {
      workspace_id,
      user_id,
      required_channel: "both",
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<ChannelReadinessGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");
  const decision = output.attributes?.launch_readiness as ChannelReadinessDecision;
  assert.equal(decision.launch_ready, false);
  assert.equal(decision.next_action, "connect_linkedin");
  assert.equal(decision.ready_checks, 1);
  assert.equal(decision.total_checks, 2);
  assert.deepEqual(toolCalls, ["product.launch.readiness.get"]);
  assert.equal(
    bus.published.some((event) => event.event_type === "workspace.launch.readiness.checked"),
    true,
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "channel readiness must not enqueue or send outreach",
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

const launchReadinessStatusSchema = z.enum(["ready", "needs_attention", "blocked"]);
const channelReadinessOutputSchema = z.object({
  workspace_id: z.string().uuid(),
  checked_at: z.string().datetime(),
  required_channel: z.enum(["any", "email", "linkedin", "both"]),
  status: launchReadinessStatusSchema,
  launch_ready: z.boolean(),
  next_action: z.enum([
    "start_outreach",
    "configure_profile",
    "configure_icp",
    "configure_rep",
    "configure_sources",
    "configure_play",
    "connect_outlook",
    "connect_linkedin",
    "repair_channel",
  ]),
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    primitive: z.enum(["Rep", "Signal", "Play", "Conversation"]),
    status: launchReadinessStatusSchema,
    required: z.boolean(),
    detail: z.string(),
    count: z.number().int().nonnegative(),
    action: z.object({
      label: z.string(),
      tools: z.array(z.string()),
      surface: z.string(),
    }).nullable(),
  })),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});
