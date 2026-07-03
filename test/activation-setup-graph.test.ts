import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { z } from "zod";
import {
  runActivationSetupGraphInWorkflowStep,
  type ActivationLaunchChecklist,
  type ActivationSetupGraphInput,
  type BombsellLangGraphState,
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

test("activation setup graph: turns a website URL into a gated setup draft without sending", async () => {
  _resetToolRegistry();
  const bus = createInMemoryEventBus();
  const runtime = createInProcessWorkflowRuntime({ bus });
  const workspace_id = randomUUID();
  const user_id = randomUUID();
  const company_id = randomUUID();
  const rep_id = randomUUID();
  const icp_id = randomUUID();
  const email_play_id = randomUUID();
  const linkedin_play_id = randomUUID();
  const toolCalls: string[] = [];
  const emailSignalKinds: string[] = [];
  const linkedInSignalKinds: string[] = [];

  registerActivationStubTools({
    toolCalls,
    emailSignalKinds,
    linkedInSignalKinds,
    company_id,
    rep_id,
    icp_id,
    email_play_id,
    linkedin_play_id,
  });

  runtime.register(
    defineWorkflow<ActivationSetupGraphInput, BombsellLangGraphState>({
      name: "activation_setup_graph_test",
      version: "1",
      async run(input, ctx) {
        return runActivationSetupGraphInWorkflowStep({
          ctx,
          input,
          bus,
        });
      },
    }),
  );

  const run = await runtime.start({
    workspace_id,
    workflow_name: "activation_setup_graph_test",
    input: {
      workspace_id,
      user_id,
      website_url: "acme.ai",
      company_hint: "Acme AI",
      allowed_industries: ["AI", "Developer tools"],
    },
  });

  await until(async () => (await runtime.get(run.id))?.status === "completed");
  const final = await runtime.get<ActivationSetupGraphInput, BombsellLangGraphState>(run.id);
  const output = final?.output;
  assert.ok(output, "expected graph output");
  assert.equal(output.rep_id, rep_id);
  assert.equal(output.play_id, linkedin_play_id);
  assert.equal(output.company_id, company_id);
  assert.equal(output.attributes?.ready_to_launch, false);

  const checklist = output.attributes?.launch_checklist as ActivationLaunchChecklist;
  assert.equal(checklist.ready_to_launch, false);
  assert.equal(checklist.send_blocked, true);
  assert.equal(
    checklist.items.find((item) => item.id === "outlook_connection")?.status,
    "blocked",
  );
  assert.equal(
    checklist.items.find((item) => item.id === "linkedin_connection")?.status,
    "blocked",
  );
  assert.match(
    String(output.attributes?.profile_draft && JSON.stringify(output.attributes.profile_draft)),
    /Acme AI/,
  );

  assert.deepEqual(toolCalls, [
    "product.company.website_profile.extract",
    "product.company.profile.configure",
    "product.activation.configure",
    "product.play.signal_linkedin.configure",
    "product.play.signal_email.configure",
    "product.play.signal_email.configure",
    "product.play.signal_linkedin.configure",
    "product.play.signal_linkedin.configure",
    "product.sources.default_aggregator.configure",
    "product.outlook_account.connect_url.get",
    "product.linkedin_account.connect_url.get",
    "product.signal.ingestion.run",
  ]);
  assert.deepEqual(emailSignalKinds, ["product_launch", "hiring"]);
  assert.deepEqual(linkedInSignalKinds, [
    "press_mention",
    "product_launch",
    "hiring",
  ]);

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
      ["message.queued", "message.sent", "message.deferred"].includes(event.event_type)
    ),
    false,
    "activation must not enqueue or send outreach",
  );

  const spanKinds = new Set(
    bus.published
      .filter((event) => event.event_type === "agent.trace.span.recorded")
      .map((event) => event.payload.kind),
  );
  assert.equal(spanKinds.has("agent.run"), true);
  assert.equal(spanKinds.has("langgraph.node"), true);
  assert.equal(spanKinds.has("tool.call"), true);

  const toolSpanNames = bus.published
    .filter((event) => event.event_type === "agent.trace.span.recorded")
    .filter((event) => event.payload.kind === "tool.call")
    .map((event) => event.payload.name);
  assert.deepEqual(toolSpanNames, toolCalls);
});

function registerActivationStubTools(opts: {
  toolCalls: string[];
  emailSignalKinds: string[];
  linkedInSignalKinds: string[];
  company_id: string;
  rep_id: string;
  icp_id: string;
  email_play_id: string;
  linkedin_play_id: string;
}) {
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
      opts.toolCalls.push("product.company.website_profile.extract");
      assert.equal(input.website_url, "https://acme.ai");
      return {
        company_name: input.company_hint ?? "Acme AI",
        website_url: input.website_url,
        industry: null,
        description:
          "Acme AI helps revenue teams turn public market movement into qualified conversations.",
      };
    },
  });

  registerTool({
    name: "product.company.profile.configure",
    description: "Configure workspace company profile.",
    kind: "write",
    input: z.object({
      company_name: z.string(),
      website_url: z.string(),
      industry: z.string().optional(),
      description: z.string().optional(),
      profile_source: z.enum(["manual", "firecrawl", "fallback"]).optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      company_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      opts.toolCalls.push("product.company.profile.configure");
      assert.equal(input.company_name, "Acme AI");
      assert.equal(input.profile_source, "firecrawl");
      return { workspace_id: ctx.workspace_id, company_id: opts.company_id };
    },
  });

  registerTool({
    name: "product.activation.configure",
    description: "Configure activation primitives.",
    kind: "write",
    input: z.object({
      rep: z.record(z.string(), z.unknown()),
      icp: z.record(z.string(), z.unknown()),
      play: z.record(z.string(), z.unknown()).optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      rep_id: z.string().uuid(),
      icp_id: z.string().uuid(),
      play_id: z.string().uuid(),
      channel_account_id: z.string().uuid().optional(),
      tracked_company_id: z.string().uuid().optional(),
      source_id: z.string().uuid().optional(),
    }),
    async handler(input, ctx) {
      opts.toolCalls.push("product.activation.configure");
      assert.equal(input.rep.name, "Outbound agent");
      assert.equal(input.icp.signal_kind, "press_mention");
      return {
        workspace_id: ctx.workspace_id,
        rep_id: opts.rep_id,
        icp_id: opts.icp_id,
        play_id: opts.email_play_id,
      };
    },
  });

  registerTool({
    name: "product.play.signal_email.configure",
    description: "Configure an email Play.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      name: z.string().optional(),
      signal_kind: z.string().optional(),
      icp_name: z.string().optional(),
      daily_cap: z.number().optional(),
      approval: z.string().optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      play_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      opts.toolCalls.push("product.play.signal_email.configure");
      assert.equal(input.rep_id, opts.rep_id);
      opts.emailSignalKinds.push(input.signal_kind ?? "");
      return { workspace_id: ctx.workspace_id, play_id: opts.email_play_id };
    },
  });

  registerTool({
    name: "product.play.signal_linkedin.configure",
    description: "Configure a LinkedIn Play.",
    kind: "write",
    input: z.object({
      rep_id: z.string().uuid(),
      name: z.string().optional(),
      signal_kind: z.string().optional(),
      icp_name: z.string().optional(),
      action: z.string().optional(),
      daily_cap: z.number().optional(),
      approval: z.string().optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      play_id: z.string().uuid(),
    }),
    async handler(input, ctx) {
      opts.toolCalls.push("product.play.signal_linkedin.configure");
      assert.equal(input.rep_id, opts.rep_id);
      assert.equal(input.action, "linkedin_dm");
      opts.linkedInSignalKinds.push(input.signal_kind ?? "");
      return { workspace_id: ctx.workspace_id, play_id: opts.linkedin_play_id };
    },
  });

  registerTool({
    name: "product.sources.default_aggregator.configure",
    description: "Configure default Signal sources.",
    kind: "write",
    input: z.object({
      company_name: z.string(),
      website_url: z.string().optional(),
      industry: z.string().optional(),
      description: z.string().optional(),
      signal_keywords: z.string().optional(),
      competitor_watchlist: z.string().optional(),
      linkedin_signal_behaviors: z.string().optional(),
      signal_kind: z.string().optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      source_count: z.number().int().nonnegative(),
    }),
    async handler(_input, ctx) {
      opts.toolCalls.push("product.sources.default_aggregator.configure");
      assert.equal(_input.industry, undefined);
      assert.equal(_input.signal_keywords, undefined);
      assert.equal(_input.competitor_watchlist, undefined);
      assert.equal(_input.linkedin_signal_behaviors, undefined);
      return { workspace_id: ctx.workspace_id, source_count: 4 };
    },
  });

  registerTool({
    name: "product.outlook_account.connect_url.get",
    description: "Get Outlook connect URL.",
    kind: "read",
    input: z.object({}),
    output: z.object({
      workspace_id: z.string().uuid(),
      connect_url: z.string(),
      provider_configured: z.boolean(),
    }),
    async handler(_input, ctx) {
      opts.toolCalls.push("product.outlook_account.connect_url.get");
      return {
        workspace_id: ctx.workspace_id,
        connect_url: "/api/auth/outlook",
        provider_configured: true,
      };
    },
  });

  registerTool({
    name: "product.linkedin_account.connect_url.get",
    description: "Get LinkedIn connect URL.",
    kind: "read",
    input: z.object({}),
    output: z.object({
      workspace_id: z.string().uuid(),
      connect_url: z.string(),
      provider_configured: z.boolean(),
    }),
    async handler(_input, ctx) {
      opts.toolCalls.push("product.linkedin_account.connect_url.get");
      return {
        workspace_id: ctx.workspace_id,
        connect_url: "/api/auth/linkedin",
        provider_configured: true,
      };
    },
  });

  registerTool({
    name: "product.signal.ingestion.run",
    description: "Start initial Signal ingestion.",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().optional(),
      wait: z.boolean().optional(),
      idempotency_nonce: z.string().optional(),
    }),
    output: z.object({
      workspace_id: z.string().uuid(),
      workflow_name: z.literal("workspace.signal.ingestion"),
      workflow_run_id: z.string(),
      output: z.unknown().nullable(),
    }),
    async handler(input, ctx) {
      opts.toolCalls.push("product.signal.ingestion.run");
      assert.equal(input.limit, 4);
      assert.equal(input.wait, false);
      assert.match(input.idempotency_nonce ?? "", /^activation:/);
      return {
        workspace_id: ctx.workspace_id,
        workflow_name: "workspace.signal.ingestion" as const,
        workflow_run_id: "initial-signal-ingestion",
        output: null,
      };
    },
  });
}
