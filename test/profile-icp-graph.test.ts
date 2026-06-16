import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runProfileIcpGraphInWorkflowStep,
  type BombsellLangGraphState,
  type ProfileIcpDecision,
  type ProfileIcpGraphInput,
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

test("profile ICP graph drafts source-backed profile and ICP without setup writes or sends", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const toolCalls: string[] = [];

  registerTool({
    name: "product.company.website_profile.extract",
    description: "Extract a company profile from a public website.",
    kind: "external",
    input: z.object({
      website_url: z.string(),
      company_hint: z.string().optional(),
      allowed_industries: z.array(z.string()).optional(),
    }),
    output: z.object({
      company_name: z.string().nullable(),
      website_url: z.string(),
      industry: z.string().nullable(),
      description: z.string().nullable(),
    }).nullable(),
    async handler(input) {
      toolCalls.push("product.company.website_profile.extract");
      assert.equal(input.website_url, "https://acme.ai");
      return {
        company_name: input.company_hint ?? "Acme AI",
        website_url: input.website_url,
        industry: "AI GTM",
        description:
          "Acme AI helps founder-led revenue teams turn public market movement into qualified conversations.",
      };
    },
  });

  runtime.register(
    defineWorkflow<ProfileIcpGraphInput, BombsellLangGraphState>({
      name: "profile_icp_graph_test",
      version: "1",
      async run(input, ctx) {
        return runProfileIcpGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "profile_icp_graph_test",
    input: {
      workspace_id,
      user_id,
      website_url: "acme.ai",
      company_hint: "Acme AI",
      allowed_industries: ["AI GTM"],
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<ProfileIcpGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");

  const decision = output.attributes?.profile_icp as ProfileIcpDecision;
  assert.equal(decision.company_name, "Acme AI");
  assert.equal(decision.website_url, "https://acme.ai");
  assert.equal(decision.signal_kind, "press_mention");
  assert.equal(decision.next_action, "review_profile_and_icp");
  assert.match(
    JSON.stringify(output.attributes?.icp_draft),
    /fresh public momentum/,
  );

  assert.deepEqual(toolCalls, ["product.company.website_profile.extract"]);
  for (const expected of [
    "workspace.activation.requested",
    "workspace.profile.drafted",
    "icp.drafted",
  ]) {
    assert.equal(
      bus.published.some((event) => event.event_type === expected),
      true,
      `expected ${expected}`,
    );
  }

  assert.equal(
    bus.published.some((event) =>
      [
        "workspace.company.profiled",
        "workspace.icp.configured",
        "rep.configured",
        "play.configured",
        "message.queued",
        "message.sent",
        "message.deferred",
      ].includes(event.event_type)
    ),
    false,
    "profile ICP draft must not configure setup primitives or send outreach",
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
