import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runLeadMatchingGraphInWorkflowStep,
  type BombsellLangGraphState,
  type LeadMatchingDecision,
  type LeadMatchingGraphInput,
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

test("lead matching graph: ranks Signal matches and does not send outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const lowerIcp = randomUUID();
  const higherIcp = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.signal.match",
    description: "Classify one Signal against enabled ICPs.",
    kind: "write",
    input: z.object({ signal_id: z.string().uuid() }),
    output: z.object({
      workspace_id: z.string().uuid(),
      signal_id: z.string().uuid(),
      status: z.enum(["matched", "dismissed", "skipped"]),
      kind: z.string().nullable(),
      matched_icp_ids: z.array(z.string().uuid()),
      match_score: z.number().min(0).max(1).nullable(),
      match_reason: z.string().nullable(),
      matches: z.array(z.object({
        icp_segment: z.string().uuid(),
        match_score: z.number().min(0).max(1),
        reason: z.string(),
      })),
      skip_reason: z.enum([
        "no_icps",
        "budget",
        "not_found",
        "non_json",
        "filtered",
      ]).nullable(),
    }),
    async handler(input, ctx) {
      toolCalls.push("product.signal.match");
      assert.equal(input.signal_id, signal_id);
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      await bus.publish({
        workspace_id,
        event_type: "signal.classification.completed",
        source: "system",
        producer_ref: "test:product.signal.match",
        correlation_id: ctx.correlation_id,
        causation_id: ctx.causation_id,
        payload: {
          signal_id,
          kind: "hiring",
          disposition: "matched",
          match_score: 0.91,
          match_reason: "Hiring expansion matches the enterprise growth ICP.",
          audience_hint: {},
          matches: [
            {
              icp_segment: lowerIcp,
              match_score: 0.74,
              reason: "Relevant, but less specific.",
            },
            {
              icp_segment: higherIcp,
              match_score: 0.91,
              reason: "Enterprise hiring expansion is a strong fit.",
            },
          ],
        },
      });
      return {
        workspace_id,
        signal_id,
        status: "matched",
        kind: "hiring",
        matched_icp_ids: [lowerIcp, higherIcp],
        match_score: 0.91,
        match_reason: "Hiring expansion matches the enterprise growth ICP.",
        matches: [
          {
            icp_segment: lowerIcp,
            match_score: 0.74,
            reason: "Relevant, but less specific.",
          },
          {
            icp_segment: higherIcp,
            match_score: 0.91,
            reason: "Enterprise hiring expansion is a strong fit.",
          },
        ],
        skip_reason: null,
      };
    },
  });

  runtime.register(
    defineWorkflow<LeadMatchingGraphInput, BombsellLangGraphState>({
      name: "lead_matching_graph_test",
      version: "1",
      async run(input, ctx) {
        return runLeadMatchingGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "lead_matching_graph_test",
    input: {
      workspace_id,
      user_id,
      signal_id,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<LeadMatchingGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");
  assert.equal(output.signal_id, signal_id);

  const decision = output.attributes?.lead_matching as LeadMatchingDecision;
  assert.equal(decision.status, "matched");
  assert.equal(decision.contact_resolution_ready, true);
  assert.equal(decision.next_action, "resolve_contacts");
  assert.equal(decision.ranked_matches[0]?.icp_segment, higherIcp);
  assert.equal(decision.ranked_matches[1]?.icp_segment, lowerIcp);

  assert.deepEqual(toolCalls, ["product.signal.match"]);
  assert.equal(
    bus.published.some((event) => event.event_type === "signal.classification.completed"),
    true,
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "lead matching must not enqueue or send outreach",
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
