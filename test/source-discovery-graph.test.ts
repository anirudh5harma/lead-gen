import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runSourceDiscoveryGraphInWorkflowStep,
  type BombsellLangGraphState,
  type SourceDiscoveryDecision,
  type SourceDiscoveryGraphInput,
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

test("source discovery graph composes source tools without sending outreach", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const openWebSourceId = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.sources.default_aggregator.configure",
    description: "Configure default aggregators.",
    kind: "write",
    input: z.object({
      company_name: z.string().min(1),
      website_url: z.string().optional(),
      industry: z.string().optional(),
      description: z.string().optional(),
      signal_kind: signalKindSchema.optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      source_count: z.number().int().nonnegative(),
    }),
    async handler(input, ctx) {
      toolCalls.push("product.sources.default_aggregator.configure");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.equal(input.company_name, "Acme GTM");
      assert.equal(input.signal_kind, "funding");
      return { workspace_id, source_count: 4 };
    },
  });

  registerTool({
    name: "product.signal.discover_open_web",
    description: "Configure Exa open-web source.",
    kind: "write",
    input: z.object({
      query: z.string().min(1),
      source_name: z.string().optional(),
      signal_kind: signalKindSchema.optional(),
      limit: z.number().int().positive().max(100).optional(),
      max_daily_items: z.number().int().positive().optional(),
      max_daily_calls: z.number().int().positive().optional(),
      monthly_spend_cap_usd: z.number().positive().optional(),
      enabled: z.boolean().optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      source_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      toolCalls.push("product.signal.discover_open_web");
      assert.equal(ctx.workspace_id, workspace_id);
      assert.equal(ctx.user_id, user_id);
      assert.match(input.query, /Acme GTM funding hiring/);
      assert.equal(input.source_name, "Acme GTM open-web signals");
      assert.equal(input.signal_kind, "funding");
      return { workspace_id, source_id: openWebSourceId };
    },
  });

  runtime.register(
    defineWorkflow<SourceDiscoveryGraphInput, BombsellLangGraphState>({
      name: "source_discovery_graph_test",
      version: "1",
      async run(input, ctx) {
        return runSourceDiscoveryGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "source_discovery_graph_test",
    input: {
      workspace_id,
      user_id,
      company_name: "Acme GTM",
      website_url: "https://acmegtm.example",
      industry: "AI GTM",
      description: "Finds buying signals.",
      signal_kind: "funding",
      open_web_query: "Acme GTM funding hiring",
      enable_open_web: true,
    },
  });
  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<SourceDiscoveryGraphInput, BombsellLangGraphState>(
    run.id,
  );
  const decision = final?.output?.attributes
    ?.source_discovery as SourceDiscoveryDecision;

  assert.equal(decision.workspace_id, workspace_id);
  assert.equal(decision.company_name, "Acme GTM");
  assert.equal(decision.default_source_count, 4);
  assert.equal(decision.open_web_source_id, openWebSourceId);
  assert.equal(decision.configured_source_count, 5);
  assert.equal(decision.next_action, "run_aggregator");
  assert.deepEqual(toolCalls, [
    "product.sources.default_aggregator.configure",
    "product.signal.discover_open_web",
  ]);

  assert.equal(
    bus.published.some((event) =>
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "source discovery graph must not enqueue or send outreach",
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

const signalKindSchema = z.enum([
  "funding",
  "hiring",
  "leadership_change",
  "product_launch",
  "acquisition",
  "churn_risk",
  "competitor_move",
  "podcast_mention",
  "press_mention",
  "regulation",
  "expansion",
  "layoff",
  "other",
]);
