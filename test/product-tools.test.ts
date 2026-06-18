import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  invokeTool,
  listTools,
  _resetToolRegistry,
} from "../core/agents/tools/registry.ts";
import {
  registerGraphTools,
  _resetGraphToolsRegistration,
} from "../core/graph/index.ts";
import {
  registerExaTools,
  _resetExaToolsRegistration,
} from "../core/exa/index.ts";
import { createMcpManifest } from "../core/mcp/manifest.ts";
import {
  registerProductTools,
  _resetProductToolsRegistration,
} from "../core/product/tools.ts";

beforeEach(() => {
  _resetToolRegistry();
  _resetGraphToolsRegistration();
  _resetExaToolsRegistration();
  _resetProductToolsRegistration();
});

test("product tools: registerProductTools exposes current UI actions to agents", () => {
  registerProductTools();
  const names = new Set(listTools().map((tool) => tool.name));

  for (const expected of [
    "product.state.get",
    "product.brief.get",
    "product.context.get",
    "product.company_brain.recall",
    "product.company_brain.brief.refresh",
    "product.vertical_intelligence.refresh",
    "product.readiness.get",
    "product.launch.readiness.get",
    "product.agent_observability.summary.get",
    "product.conversation.trust.get",
    "product.meeting.prep.generate",
    "product.company.website_profile.extract",
    "product.profile_icp.draft",
    "product.activation.setup.run",
    "product.company.profile.configure",
    "product.profile.enrich",
    "product.brief.refresh",
    "product.rep.research",
    "product.exa.research_workflow.start",
    "product.draft.ground",
    "product.rep.configure",
    "product.icp.configure",
    "product.play.signal_email.configure",
    "product.play.signal_linkedin.configure",
    "product.play.skills.list",
    "product.play.skills.select",
    "product.message.personalize",
    "product.draft.eval.gate",
    "product.reply.triage",
    "product.email_account.configure",
    "product.outlook_account.connect_url.get",
    "product.outlook_calendar.connect_url.get",
    "product.outlook_calendar.availability.get",
    "product.linkedin_account.connect_url.get",
    "product.company.track",
    "product.source.configure",
    "product.activation.configure",
    "product.sources.default_aggregator.configure",
    "product.signal.discover_open_web",
    "product.campaign.outcome.record",
    "product.campaign.strategy.optimize",
    "product.play.skills.optimize",
    "product.contact.waterfall.resolve",
    "product.sources.poll.start",
    "product.signal.ingestion.run",
    "product.signal.matching.run",
    "product.sources.aggregate.run",
    "product.signal.discover",
    "product.signal.submit",
    "product.signal.match",
    "product.signals.dispatch_plays",
    "product.approval.decide",
    "product.workflow.retry",
    "product.event_dispatch.dead_letters.list",
    "product.event_dispatch.redrive",
    "product.sending_domain.operate",
  ]) {
    assert.ok(names.has(expected), `expected product tool ${expected}`);
  }

  for (const retired of [
    "product.content.opportunities.discover",
    "product.aeo.audit",
    "product.recommendation.review",
    "product.recommendation.update",
    "product.recommendation.delete",
    "product.recommendation.draft.create",
    "product.recommendation.outcome.record",
  ]) {
    assert.ok(!names.has(retired), `retired product tool should not be exposed: ${retired}`);
  }
});

test("product tools: write tools require authenticated user context", async () => {
  registerProductTools();
  const sourceTool = listTools().find((tool) => tool.name === "product.source.configure");
  assert.equal(sourceTool?.kind, "write");

  await assert.rejects(
    sourceTool!.handler(
      {
        adapter: "google_news",
        name: "Market news",
        query: "B2B SaaS hiring",
      },
      { workspace_id: crypto.randomUUID() },
    ),
    /Authenticated user context/,
  );
});

test("product tools: readiness read requires authenticated user context", async () => {
  registerProductTools();

  await assert.rejects(
    invokeTool("product.readiness.get", {}, { workspace_id: crypto.randomUUID() }),
    /Authenticated user context/,
  );
});

test("product tools: Exa source discovery returns a source handle", () => {
  registerProductTools();
  const tool = listTools().find((registered) => registered.name === "product.signal.discover_open_web");
  assert.ok(tool, "expected Exa open-web Signal tool");

  const parsed = tool.output.parse({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    source_id: "00000000-0000-4000-8000-000000000002",
  });

  assert.equal(parsed.source_id, "00000000-0000-4000-8000-000000000002");
});

test("product tools: company brain brief refresh exposes durable workflow handle", () => {
  registerProductTools();
  const tool = listTools().find((registered) =>
    registered.name === "product.company_brain.brief.refresh"
  );
  assert.equal(tool?.kind, "write");

  const parsedInput = tool!.input.parse({
    brief_type: "objection_bank",
    task: "Refresh objection handling context.",
    wait: false,
  });
  assert.equal(parsedInput.brief_type, "objection_bank");
  assert.equal(parsedInput.wait, false);

  const parsedOutput = tool!.output.parse({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    workflow_name: "workspace.company_brain.brief",
    workflow_run_id: "run-company-brain-brief",
    output: null,
  });
  assert.equal(parsedOutput.workflow_name, "workspace.company_brain.brief");
});

test("product tools: activation setup exposes setup and initial Signal ingestion handles", () => {
  registerProductTools();
  const tool = listTools().find((registered) =>
    registered.name === "product.activation.setup.run"
  );
  assert.equal(tool?.kind, "write");

  const parsedInput = tool!.input.parse({
    website_url: "acme.ai",
    company_hint: "Acme AI",
    industry_hint: "Software Development & SaaS",
    description_hint: "Turns quality signals into verified outreach.",
    customer_pain_points: "Teams miss buying intent and lack verified contacts.",
    target_titles: "VP of Sales\nHead of Growth",
    target_markets: "North America\nB2B SaaS",
    key_features: "Signal tracking\nVerified email and LinkedIn profiles",
    social_proof: "Used by founder-led GTM teams.",
    signal_keywords: "intent data\nlinkedin prospecting",
    competitor_watchlist: "Apollo.io\nZoomInfo",
    exclusion_rules: "Service providers\nOpen to work",
    preferred_language: "English (US)",
    outreach_goal: "conversations",
    message_tone: "professional",
    allowed_industries: ["AI", "Developer tools"],
    wait: false,
  });
  assert.equal(parsedInput.website_url, "acme.ai");
  assert.equal(parsedInput.target_titles, "VP of Sales\nHead of Growth");
  assert.equal(parsedInput.signal_keywords, "intent data\nlinkedin prospecting");
  assert.equal(parsedInput.outreach_goal, "conversations");
  assert.equal(parsedInput.message_tone, "professional");
  assert.equal(parsedInput.wait, false);

  const parsedOutput = tool!.output.parse({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    workflow_name: "workspace.activation.setup",
    workflow_run_id: "run-activation-setup",
    output: null,
    initial_signal_ingestion: {
      workflow_name: "workspace.signal.ingestion",
      workflow_run_id: "run-signal-ingestion",
      output: null,
    },
  });
  assert.equal(parsedOutput.workflow_name, "workspace.activation.setup");
  assert.equal(
    parsedOutput.initial_signal_ingestion?.workflow_name,
    "workspace.signal.ingestion",
  );
});

test("product tools: Outlook calendar consent exposes meeting-prep readiness handles", () => {
  registerProductTools();
  const connectTool = listTools().find((registered) =>
    registered.name === "product.outlook_calendar.connect_url.get"
  );
  const availabilityTool = listTools().find((registered) =>
    registered.name === "product.outlook_calendar.availability.get"
  );
  assert.equal(connectTool?.kind, "read");
  assert.equal(availabilityTool?.kind, "read");

  const connectOutput = connectTool!.output.parse({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    connect_url: "/api/auth/outlook?intent=calendar",
    provider_configured: true,
    scope: "Calendars.ReadBasic",
  });
  assert.equal(connectOutput.scope, "Calendars.ReadBasic");
  assert.match(connectOutput.connect_url, /intent=calendar/);

  const availabilityOutput = availabilityTool!.output.parse({
    consented: false,
    provider: "outlook",
    channel_account_id: null,
    account_display_name: null,
    suggested_times: [],
    reason: "calendar_permission_missing",
  });
  assert.equal(availabilityOutput.reason, "calendar_permission_missing");
});

test("product tools: Signal matching exposes durable workflow handle", () => {
  registerProductTools();
  const tool = listTools().find((registered) =>
    registered.name === "product.signal.matching.run"
  );
  assert.equal(tool?.kind, "write");

  const parsedInput = tool!.input.parse({
    signal_id: "00000000-0000-4000-8000-000000000010",
    wait: false,
  });
  assert.equal(parsedInput.signal_id, "00000000-0000-4000-8000-000000000010");
  assert.equal(parsedInput.wait, false);

  const parsedOutput = tool!.output.parse({
    workspace_id: "00000000-0000-4000-8000-000000000001",
    workflow_name: "workspace.signal.matching",
    workflow_run_id: "run-signal-matching",
    output: null,
  });
  assert.equal(parsedOutput.workflow_name, "workspace.signal.matching");
});

test("product tools: Play skill list and selection expose versioned outreach skills", async () => {
  registerProductTools();
  const workspace_id = crypto.randomUUID();
  const user_id = crypto.randomUUID();

  const listed = await invokeTool<{
    workspace_id: string;
    skills: Array<{ skill_key: string }>;
  }>(
    "product.play.skills.list",
    { channel: "email", stage: "cold_open", signal_kind: "funding" },
    { workspace_id, user_id },
  );
  assert.equal(listed.workspace_id, workspace_id);
  assert.ok(
    listed.skills.some((skill) => skill.skill_key === "signal_problem_probe"),
  );

  const selected = await invokeTool<{
    skill: { skill_key: string; pattern_key: string; slot_values: Record<string, string> };
  }>(
    "product.play.skills.select",
    {
      channel: "email",
      stage: "cold_open",
      signal_kind: "funding",
      base_pattern_key: "icp:fintech-founder|signal:funding|stage:cold_open",
      slot_values: {
        signal_hook: "Acme raised a Series A",
      },
    },
    { workspace_id, user_id },
  );
  assert.equal(selected.skill.skill_key, "signal_problem_probe");
  assert.match(selected.skill.pattern_key, /skill:signal_problem_probe@v1/);
  assert.equal(selected.skill.slot_values.signal_hook, "Acme raised a Series A");
});

test("agent-native capability map references registered tools", () => {
  registerGraphTools();
  registerExaTools();
  registerProductTools();
  const names = new Set(listTools().map((tool) => tool.name));
  const map = readFileSync("docs/agent-native-capability-map.md", "utf8");
  const refs = [...map.matchAll(/`((?:product|graph)\.[^`]+)`/g)]
    .flatMap((match) => match[1]!.split(",").map((part) => part.trim()))
    .filter(Boolean);

  assert.ok(refs.length > 0, "capability map should reference agent tools");
  for (const ref of refs) {
    if (ref.endsWith(".*")) {
      const prefix = ref.slice(0, -1);
      assert.ok(
        [...names].some((name) => name.startsWith(prefix)),
        `expected registered tool with prefix ${prefix}`,
      );
      continue;
    }
    assert.ok(names.has(ref), `expected registered tool ${ref}`);
  }
});

test("MCP manifest includes every registered product and graph tool", () => {
  registerGraphTools();
  registerExaTools();
  registerProductTools();
  const registered = listTools().map((tool) => tool.name).sort();
  const manifest = createMcpManifest(null);

  assert.deepEqual(manifest.tools, registered);
});
