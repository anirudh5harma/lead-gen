import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  createWorkspaceSignalMatchingWorkflow,
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

const SignalMatchToolOutputSchema = z.object({
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
});

async function runLeadMatchingTestWorkflow(opts: {
  bus: ReturnType<typeof createInMemoryEventBus>;
  workspace_id: string;
  user_id: string;
  signal_id: string;
}): Promise<BombsellLangGraphState> {
  const runtime = createInProcessWorkflowRuntime({ bus: opts.bus });
  runtime.register(
    defineWorkflow<LeadMatchingGraphInput, BombsellLangGraphState>({
      name: "lead_matching_graph_test",
      version: "1",
      async run(input, ctx) {
        return runLeadMatchingGraphInWorkflowStep({
          ctx,
          input,
          bus: opts.bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id: opts.workspace_id,
    workflow_name: "lead_matching_graph_test",
    input: {
      workspace_id: opts.workspace_id,
      user_id: opts.user_id,
      signal_id: opts.signal_id,
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<LeadMatchingGraphInput, BombsellLangGraphState>(run.id);
  assert.ok(final?.output, "expected graph output");
  return final.output;
}

test("lead matching graph: ranks Signal matches and does not send outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
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
    output: SignalMatchToolOutputSchema,
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

  const output = await runLeadMatchingTestWorkflow({
    bus,
    workspace_id,
    user_id,
    signal_id,
  });

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

test("signal matching workflow: parks budget deferrals before retrying", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const icp_id = randomUUID();
  let calls = 0;

  registerTool({
    name: "product.signal.match",
    description: "Classify one Signal against enabled ICPs.",
    kind: "write",
    input: z.object({ signal_id: z.string().uuid() }),
    output: SignalMatchToolOutputSchema,
    async handler() {
      calls += 1;
      if (calls === 1) {
        return {
          workspace_id,
          signal_id,
          status: "skipped" as const,
          kind: null,
          matched_icp_ids: [],
          match_score: null,
          match_reason: "budget",
          matches: [],
          skip_reason: "budget" as const,
        };
      }
      return {
        workspace_id,
        signal_id,
        status: "matched" as const,
        kind: "funding",
        matched_icp_ids: [icp_id],
        match_score: 0.9,
        match_reason: "Budget window reopened.",
        matches: [{
          icp_segment: icp_id,
          match_score: 0.9,
          reason: "Budget window reopened.",
        }],
        skip_reason: null,
      };
    },
  });
  runtime.register(createWorkspaceSignalMatchingWorkflow({
    bus,
    budgetRetryDelayMs: 0,
    budgetMaxRetries: 1,
  }));

  const run = await runtime.start({
    workspace_id,
    workflow_name: "workspace.signal.matching",
    input: { workspace_id, user_id, signal_id },
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const completed = await runtime.get<LeadMatchingGraphInput, BombsellLangGraphState>(run.id);
  const decision = completed?.output?.attributes?.lead_matching as
    | LeadMatchingDecision
    | undefined;

  assert.equal(calls, 2);
  assert.equal(decision?.next_action, "resolve_contacts");
});

test("lead matching graph: deterministically dedupes and ranks matches", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const firstIcp = "00000000-0000-4000-8000-000000000001";
  const secondIcp = "00000000-0000-4000-8000-000000000002";

  registerTool({
    name: "product.signal.match",
    description: "Classify one Signal against enabled ICPs.",
    kind: "write",
    input: z.object({ signal_id: z.string().uuid() }),
    output: SignalMatchToolOutputSchema,
    async handler() {
      return {
        workspace_id,
        signal_id,
        status: "matched",
        kind: "hiring",
        matched_icp_ids: [firstIcp, secondIcp],
        match_score: 0.8,
        match_reason: "Tie should be stable.",
        matches: [
          { icp_segment: secondIcp, match_score: 0.8, reason: "Second tie." },
          { icp_segment: firstIcp, match_score: 0.72, reason: "Older duplicate." },
          { icp_segment: firstIcp, match_score: 0.8, reason: "First tie." },
        ],
        skip_reason: null,
      };
    },
  });

  const output = await runLeadMatchingTestWorkflow({
    bus,
    workspace_id,
    user_id,
    signal_id,
  });
  const decision = output.attributes?.lead_matching as LeadMatchingDecision;

  assert.equal(decision.status, "matched");
  assert.equal(decision.contact_resolution_ready, true);
  assert.deepEqual(
    decision.ranked_matches.map((match) => match.icp_segment),
    [firstIcp, secondIcp],
  );
  assert.equal(decision.match_score, 0.8);
  assert.equal(decision.ranked_matches.length, 2);
});

test("lead matching graph: defers matched output with no candidates", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const icp = randomUUID();

  registerTool({
    name: "product.signal.match",
    description: "Classify one Signal against enabled ICPs.",
    kind: "write",
    input: z.object({ signal_id: z.string().uuid() }),
    output: SignalMatchToolOutputSchema,
    async handler() {
      return {
        workspace_id,
        signal_id,
        status: "matched",
        kind: "funding",
        matched_icp_ids: [icp],
        match_score: 0.91,
        match_reason: "Malformed classifier result.",
        matches: [],
        skip_reason: null,
      };
    },
  });

  const output = await runLeadMatchingTestWorkflow({
    bus,
    workspace_id,
    user_id,
    signal_id,
  });
  const decision = output.attributes?.lead_matching as LeadMatchingDecision;

  assert.equal(decision.status, "skipped");
  assert.equal(decision.contact_resolution_ready, false);
  assert.equal(decision.next_action, "review_signal");
  assert.equal(decision.defer_reason, "empty_candidates");
  assert.equal(deferredReason(bus, signal_id), "empty_candidates");
  const typedDeferred = matchingDeferred(bus, signal_id);
  assert.equal(typedDeferred?.workspace_id, workspace_id);
  assert.equal(typedDeferred?.payload.workspace_id, workspace_id);
  assert.equal(typedDeferred?.payload.signal_id, signal_id);
  assert.equal(typedDeferred?.payload.defer_reason, "empty_candidates");
  assert.equal(typedDeferred?.source, "agent");
  assert.match(
    typedDeferred?.idempotency_key ?? "",
    /lead\.matching_graph\.v1:deferred:.+:empty_candidates/,
  );
});

test("lead matching graph: defers sub-threshold matches before contact resolution", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const signal_id = randomUUID();
  const icp = randomUUID();

  registerTool({
    name: "product.signal.match",
    description: "Classify one Signal against enabled ICPs.",
    kind: "write",
    input: z.object({ signal_id: z.string().uuid() }),
    output: SignalMatchToolOutputSchema,
    async handler() {
      return {
        workspace_id,
        signal_id,
        status: "matched",
        kind: "press_mention",
        matched_icp_ids: [icp],
        match_score: 0.59,
        match_reason: "Below the launch matching threshold.",
        matches: [
          {
            icp_segment: icp,
            match_score: 0.59,
            reason: "Below the launch matching threshold.",
          },
        ],
        skip_reason: null,
      };
    },
  });

  const output = await runLeadMatchingTestWorkflow({
    bus,
    workspace_id,
    user_id,
    signal_id,
  });
  const decision = output.attributes?.lead_matching as LeadMatchingDecision;

  assert.equal(decision.status, "skipped");
  assert.equal(decision.contact_resolution_ready, false);
  assert.equal(decision.next_action, "review_signal");
  assert.equal(decision.defer_reason, "below_eval_threshold");
  assert.equal(deferredReason(bus, signal_id), "below_eval_threshold");
  assert.equal(
    matchingDeferred(bus, signal_id)?.payload.defer_reason,
    "below_eval_threshold",
  );
  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
  );
});

function matchingDeferred(
  bus: ReturnType<typeof createInMemoryEventBus>,
  signal_id: string,
) {
  return bus.published.find((event) =>
    event.event_type === "signal.matching.deferred" &&
    event.payload.signal_id === signal_id
  );
}

function deferredReason(
  bus: ReturnType<typeof createInMemoryEventBus>,
  signal_id: string,
): unknown {
  const deferred = bus.published.find((event) =>
    event.event_type === "agent.trace.span.recorded" &&
    event.payload.status === "deferred" &&
    event.payload.primitive_refs?.signal_id === signal_id
  );
  return deferred?.payload.attributes.defer_reason;
}
