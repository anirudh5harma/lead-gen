import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  invokeTool,
  listTools,
  registerTool,
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
import { BOMBSELL_MCP_INSTRUCTIONS } from "../core/mcp/instructions.ts";
import {
  BOMBSELL_MCP_OAUTH_SCOPES,
  mcpAuthorizationServerMetadata,
  mcpProtectedResourceMetadata,
} from "../core/mcp/oauth-metadata.ts";
import {
  normalizeMcpScope,
  pkceS256,
  safeRedirectUri,
  tokenHash,
  validateMcpAccessToken,
} from "../core/mcp/oauth.ts";
import {
  registerBombsellAliasTools,
  _resetBombsellAliasToolsRegistration,
} from "../core/product/bombsell-tools.ts";
import { buildOutputDestinations } from "../core/product/output-destinations.ts";
import {
  registerProductTools,
  _resetProductToolsRegistration,
} from "../core/product/tools.ts";

function readProjectFile(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function projectFileExists(path: string): boolean {
  return existsSync(new URL(`../${path}`, import.meta.url));
}

beforeEach(() => {
  _resetToolRegistry();
  _resetGraphToolsRegistration();
  _resetExaToolsRegistration();
  _resetProductToolsRegistration();
  _resetBombsellAliasToolsRegistration();
});

test("product tools: registerProductTools exposes current UI actions to agents", () => {
  registerProductTools();
  const names = new Set(listTools().map((tool) => tool.name));

  for (const expected of [
    "product.state.get",
    "product.brief.get",
    "product.context.get",
    "product.qualified_signals.list",
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
    "bombsell.brief.get",
    "bombsell.launch.check",
    "bombsell.profile.propose_from_context",
    "bombsell.signals.list_qualified",
    "bombsell.contact_lanes.get",
    "bombsell.integrations.list",
    "bombsell.outreach.prepare",
    "bombsell.outreach.list_sent",
    "bombsell.draft.get",
    "bombsell.approvals.list",
    "bombsell.approvals.decide",
    "bombsell.learning.get",
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
    linkedin_signal_behaviors:
      "Company and team engagement\nKeyworded post likes and comments",
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
  assert.equal(
    parsedInput.linkedin_signal_behaviors,
    "Company and team engagement\nKeyworded post likes and comments",
  );
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
  const map = readProjectFile("docs/agent-native-capability-map.md");
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

test("MCP manifest guides external agents through Brief, Agent, and Profile", () => {
  registerGraphTools();
  registerExaTools();
  registerProductTools();
  const manifest = createMcpManifest(null);

  assert.equal(manifest.instructions, BOMBSELL_MCP_INSTRUCTIONS);
  assert.deepEqual(manifest.product_surfaces, ["Brief", "Agent", "Profile"]);
  assert.equal(manifest.recommended_entry_tool, "product.brief.get");
  assert.match(manifest.auth, /oauth-protected-resource/);
  assert.equal(
    manifest.oauth_protected_resource,
    "/.well-known/oauth-protected-resource",
  );
  assert.equal(
    manifest.oauth_authorization_server,
    "/.well-known/oauth-authorization-server",
  );
  assert.ok(
    BOMBSELL_MCP_INSTRUCTIONS.length < 2000,
    "Claude Code tool-search instructions should stay concise",
  );
  for (const phrase of [
    "qualified signals",
    "verified contacts",
    "email and LinkedIn outreach",
    "approval policy",
    "hot-path eval gate",
    "bombsell.*",
  ]) {
    assert.match(BOMBSELL_MCP_INSTRUCTIONS, new RegExp(phrase));
  }
});

test("output destination model is shared by Profile and Bombsell MCP aliases", () => {
  const blocked = buildOutputDestinations({
    email_connected: false,
    linkedin_connected: false,
    launch_ready: false,
  });
  assert.deepEqual(
    blocked.map((destination) => destination.key),
    [
      "outlook",
      "linkedin",
      "claude-code",
      "signal-webhook",
      "crm-sync",
      "outreach-tool-sync",
      "team-alerts",
    ],
  );
  assert.equal(
    blocked.find((destination) => destination.key === "outlook")?.status,
    "blocked",
  );
  assert.equal(
    blocked.find((destination) => destination.key === "linkedin")?.status,
    "blocked",
  );
  assert.deepEqual(
    blocked.find((destination) => destination.key === "claude-code")?.tools,
    [
      "bombsell.brief.get",
      "bombsell.signals.list_qualified",
      "bombsell.outreach.list_sent",
    ],
  );
  assert.equal(
    blocked.find((destination) => destination.key === "signal-webhook")
      ?.handoff_stage,
    "signal_intake",
  );

  const connected = buildOutputDestinations({
    email_connected: true,
    linkedin_connected: true,
    launch_ready: true,
  });
  assert.equal(
    connected.find((destination) => destination.key === "outlook")?.status,
    "connected",
  );
  assert.equal(
    connected.find((destination) => destination.key === "linkedin")?.status,
    "connected",
  );
  assert.equal(
    connected.find((destination) => destination.key === "crm-sync")
      ?.handoff_stage,
    "qualified_contact_sync",
  );
  assert.equal(
    connected.find((destination) => destination.key === "team-alerts")
      ?.handoff_stage,
    "reply_meeting_alert",
  );
});

test("MCP OAuth metadata supports Claude Code remote auth discovery", () => {
  const request = new Request("https://www.bombsell.com/api/mcp");
  const protectedMetadata = mcpProtectedResourceMetadata(request);
  const authMetadata = mcpAuthorizationServerMetadata(request);
  const mcpRoute = readProjectFile("app/api/mcp/route.ts");

  assert.equal(protectedMetadata.resource, "https://www.bombsell.com/api/mcp");
  assert.deepEqual(protectedMetadata.authorization_servers, [
    "https://www.bombsell.com",
  ]);
  assert.deepEqual(protectedMetadata.bearer_methods_supported, ["header"]);
  assert.deepEqual(protectedMetadata.scopes_supported, [
    ...BOMBSELL_MCP_OAUTH_SCOPES,
  ]);
  assert.equal(authMetadata.issuer, "https://www.bombsell.com");
  assert.equal(
    authMetadata.authorization_endpoint,
    "https://www.bombsell.com/api/mcp/oauth/authorize",
  );
  assert.equal(
    authMetadata.token_endpoint,
    "https://www.bombsell.com/api/mcp/oauth/token",
  );
  assert.equal(
    authMetadata.registration_endpoint,
    "https://www.bombsell.com/api/mcp/oauth/register",
  );
  assert.deepEqual(authMetadata.code_challenge_methods_supported, ["S256"]);
  assert.match(mcpRoute, /resource_metadata="\$\{protectedResourceMetadataUrl\(request\)\}"/);
  assert.ok(projectFileExists("app/.well-known/oauth-protected-resource/route.ts"));
  assert.ok(projectFileExists("app/.well-known/oauth-authorization-server/route.ts"));
});

test("MCP OAuth routes issue browser PKCE tokens for Claude Code", () => {
  const authorize = readProjectFile("app/api/mcp/oauth/authorize/route.ts");
  const token = readProjectFile("app/api/mcp/oauth/token/route.ts");
  const register = readProjectFile("app/api/mcp/oauth/register/route.ts");
  const mcpRoute = readProjectFile("app/api/mcp/route.ts");
  const migration = readProjectFile("db/migrations/039_mcp_oauth.sql");
  const revokeMigration = readProjectFile("db/migrations/040_mcp_oauth_revocation.sql");
  const registry = readProjectFile("core/substrate/events/registry.ts");

  assert.match(authorize, /googleAuthPath\(next\)/);
  assert.match(authorize, /code_challenge_method !== "S256"/);
  assert.match(authorize, /mcp_oauth_codes/);
  assert.match(token, /pkceS256\(body\.code_verifier\)/);
  assert.match(token, /insert into mcp_oauth_tokens/);
  assert.match(register, /insert into mcp_oauth_clients/);
  assert.match(mcpRoute, /validateMcpAccessToken\(token\)/);
  assert.match(mcpRoute, /token\?\.startsWith\("mcp_"\)/);
  assert.match(migration, /create table if not exists mcp_oauth_clients/);
  assert.match(migration, /create table if not exists mcp_oauth_codes/);
  assert.match(migration, /create table if not exists mcp_oauth_tokens/);
  assert.match(revokeMigration, /revoked_at timestamptz/);
  assert.match(revokeMigration, /mcp_oauth_tokens_active_user_idx/);
  assert.match(registry, /const McpToolCalled = z\.object/);
  assert.match(registry, /"mcp\.tool\.called": McpToolCalled/);
  assert.match(mcpRoute, /readMcpToolCalls\(request\)/);
  assert.match(mcpRoute, /event_type: "mcp\.tool\.called"/);
  assert.match(mcpRoute, /tokenHash\(auth\.token\)\.slice\(0, 16\)/);
});

test("MCP OAuth helpers constrain redirects, scopes, PKCE, and token hashes", async () => {
  assert.equal(safeRedirectUri("https://claude.ai/api/mcp/auth_callback"), "https://claude.ai/api/mcp/auth_callback");
  assert.equal(safeRedirectUri("http://127.0.0.1:1455/callback"), "http://127.0.0.1:1455/callback");
  assert.equal(safeRedirectUri("http://evil.example/callback"), null);
  assert.equal(safeRedirectUri("javascript:alert(1)"), null);
  assert.equal(
    normalizeMcpScope("profile:read profile:read outreach:prepare unknown:scope"),
    "profile:read outreach:prepare",
  );
  assert.equal(
    normalizeMcpScope(null),
    BOMBSELL_MCP_OAUTH_SCOPES.join(" "),
  );
  assert.equal(
    pkceS256("verifier"),
    "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ",
  );
  assert.equal(tokenHash("mcp_secret").length, 64);

  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      if (/select user_id, client_id, scope/.test(sql)) {
        return {
          rows: [{
            user_id: "00000000-0000-4000-8000-000000000001",
            client_id: "mcp_client",
            scope: "brief:read outreach:prepare",
          }],
        };
      }
      return { rows: [] };
    },
  };

  const claims = await validateMcpAccessToken("mcp_secret", pool as never);
  assert.equal(claims?.userId, "00000000-0000-4000-8000-000000000001");
  assert.equal(claims?.clientId, "mcp_client");
  assert.equal(claims?.scope, "brief:read outreach:prepare");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.params[0], tokenHash("mcp_secret"));
  assert.match(calls[1]?.sql ?? "", /set last_used_at/);
  assert.match(calls[0]?.sql ?? "", /revoked_at is null/);
});

test("Claude Code plugin package exposes Bombsell's focused GTM workbench", () => {
  const root = "integrations/bombsell-claude-code";
  const manifest = JSON.parse(
    readProjectFile(`${root}/.claude-plugin/plugin.json`),
  ) as {
    name: string;
    description: string;
    version: string;
  };
  const mcp = JSON.parse(readProjectFile(`${root}/.mcp.json`)) as {
    mcpServers: {
      bombsell: {
        type: string;
        url: string;
        oauth?: { scopes?: string };
      };
    };
  };
  const pkg = JSON.parse(readProjectFile("package.json")) as {
    scripts?: Record<string, string>;
  };
  const verifier = readProjectFile("scripts/verify-claude-code-plugin.ts");
  const readme = readProjectFile(`${root}/README.md`);
  const plan = readProjectFile(
    "docs/plans/2026-06-19-001-bombsell-claude-code-plugin-plan.md",
  );
  const marketplace = JSON.parse(
    readProjectFile(
      "integrations/bombsell-claude-code-marketplace/.claude-plugin/marketplace.json",
    ),
  ) as {
    name: string;
    plugins: Array<{
      name: string;
      version: string;
      source: {
        source: string;
        url: string;
        path: string;
        sha?: string;
      };
    }>;
  };
  const skills = [
    "brief",
    "profile-from-repo",
    "launch-check",
    "signal-review",
    "prepare-outreach",
    "reply-insights",
  ];

  assert.equal(manifest.name, "bombsell");
  assert.match(manifest.description, /Brief, Profile proposals, launch checks/);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(mcp.mcpServers.bombsell.type, "http");
  assert.equal(mcp.mcpServers.bombsell.url, "https://www.bombsell.com/api/mcp");
  assert.match(mcp.mcpServers.bombsell.oauth?.scopes ?? "", /profile:read/);
  assert.match(mcp.mcpServers.bombsell.oauth?.scopes ?? "", /outreach:prepare/);
  assert.match(
    pkg.scripts?.["verify:claude-code-plugin"] ?? "",
    /scripts\/verify-claude-code-plugin\.ts/,
  );
  assert.equal(marketplace.name, "bombsell");
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0]?.name, manifest.name);
  assert.equal(marketplace.plugins[0]?.version, manifest.version);
  assert.equal(marketplace.plugins[0]?.source.source, "git-subdir");
  assert.equal(
    marketplace.plugins[0]?.source.url,
    "https://github.com/anirudh5harma/lead-gen.git",
  );
  assert.equal(
    marketplace.plugins[0]?.source.path,
    "integrations/bombsell-claude-code",
  );
  assert.match(marketplace.plugins[0]?.source.sha ?? "", /^[0-9a-f]{40}$/);
  assert.match(verifier, /claude/);
  assert.match(verifier, /plugin", "validate", "--strict"/);
  assert.match(verifier, /git-subdir/);
  assert.match(verifier, /cat-file/);
  assert.match(readme, /claude mcp add --transport http bombsell https:\/\/www\.bombsell\.com\/api\/mcp/);
  assert.match(plan, /Direct MCP dogfood/);
  assert.match(plan, /claude mcp add --transport http bombsell https:\/\/www\.bombsell\.com\/api\/mcp/);
  assert.match(plan, /bombsell\.profile\.propose_from_context/);
  assert.doesNotMatch(plan, /Future ergonomic alias/);

  for (const skill of skills) {
    const skillPath = `${root}/skills/${skill}/SKILL.md`;
    assert.ok(projectFileExists(skillPath), `expected ${skillPath}`);
    const content = readProjectFile(skillPath);
    assert.match(content, /^---\ndescription:/);
    assert.doesNotMatch(content, /headersHelper|Bearer\s+[A-Za-z0-9._-]+/);
  }

  for (const tool of [
    "bombsell.brief.get",
    "bombsell.profile.propose_from_context",
    "bombsell.launch.check",
    "bombsell.signals.list_qualified",
    "bombsell.contact_lanes.get",
    "bombsell.outreach.prepare",
    "bombsell.outreach.list_sent",
    "bombsell.draft.get",
    "bombsell.approvals.list",
    "bombsell.approvals.decide",
    "bombsell.learning.get",
  ]) {
    assert.match(readme, new RegExp(tool.replace(/\./g, "\\.")));
  }

  assert.match(readme, /proposal-only/);
  assert.match(readme, /does not send/);
  assert.match(readme, /Do not publish static bearer tokens/);
  assert.match(readme, /hosted marketplace publication/);
  assert.match(readme, /\/plugin marketplace add \.\/integrations\/bombsell-claude-code-marketplace/);
  assert.match(readme, /\/plugin install bombsell@bombsell/);
  assert.match(readme, /"source": "git-subdir"/);
  assert.match(readme, /"path": "integrations\/bombsell-claude-code"/);
  assert.match(readme, /"sha": "<release-commit-sha>"/);
  assert.match(plan, /"source": "git-subdir"/);
  assert.match(plan, /"path": "integrations\/bombsell-claude-code"/);
  assert.match(plan, /npm run verify:claude-code-plugin/);
  assert.match(plan, /pinned commit SHA/);
  assert.doesNotMatch(readme, /Sampark|plays tab|outcomes tab/i);
  assert.ok(!projectFileExists(`${root}/hooks/hooks.json`));
  assert.ok(!projectFileExists(`${root}/agents/gtm-operator.md`));
});

test("bombsell wrapper tools summarize product state for Claude Code", async () => {
  const workspace_id = crypto.randomUUID();
  const user_id = crypto.randomUUID();
  const conversation_id = crypto.randomUUID();
  const message_id = crypto.randomUUID();
  const outcome_id = crypto.randomUUID();
  const signal_id = crypto.randomUUID();
  const person_id = crypto.randomUUID();
  const linkedin_person_id = crypto.randomUUID();
  const approval_id = crypto.randomUUID();
  const rejected_approval_id = crypto.randomUUID();
  const approvalDecisions: Array<{
    approval_id: string;
    decision: string;
    note?: string;
  }> = [];
  const dispatchCalls: Array<{ limit?: number }> = [];

  registerTool({
    name: "product.brief.get",
    description: "stub brief",
    kind: "read",
    input: z.object({}),
    output: z.unknown(),
    async handler() {
      return {
        workspace_id,
        generated_at: "2026-06-19T00:00:00.000Z",
        windows: {
          last_24h: {
            qualified_signals: 3,
            emails_sent: 2,
            linkedin_dms_sent: 1,
            replies: 1,
            meetings: 0,
          },
          last_7d: {
            qualified_signals: 12,
            emails_sent: 9,
            linkedin_dms_sent: 4,
            replies: 3,
            meetings: 1,
            useful_outcomes: 4,
          },
        },
        operations: {
          pending_reviews: 1,
          unhealthy_channels: 0,
          bounced_24h: 0,
        },
        channel_readiness: {
          email_connected: true,
          linkedin_connected: true,
          connected_count: 2,
        },
        signal_types: [
          {
            kind: "funding",
            count_24h: 2,
            count_7d: 7,
            with_contacts_7d: 5,
            with_drafts_7d: 4,
          },
        ],
        next_action: {
          key: "review_drafts",
          label: "Review drafted outreach",
          detail: "One judged draft is waiting.",
          href: "/dashboard/agent#review-queue",
        },
      };
    },
  });
  registerTool({
    name: "product.launch.readiness.get",
    description: "stub readiness",
    kind: "read",
    input: z.object({
      required_channel: z.enum(["any", "email", "linkedin", "both"]).optional(),
    }),
    output: z.unknown(),
    async handler() {
      return {
        workspace_id,
        checked_at: "2026-06-19T00:01:00.000Z",
        status: "ready",
        launch_ready: true,
        next_action: "start_outreach",
        blockers: [],
        warnings: [],
        checks: [
          {
            id: "outlook",
            label: "Outlook",
            status: "ready",
            required: true,
            detail: "Connected",
            count: 1,
            action: { surface: "/dashboard/profile#channels" },
          },
        ],
      };
    },
  });
  registerTool({
    name: "product.context.get",
    description: "stub context",
    kind: "read",
    input: z.object({}),
    output: z.unknown(),
    async handler() {
      return {
        workspace_id,
        generated_at: "2026-06-19T00:01:30.000Z",
        markdown: "Profile: current workspace context for Acme.",
      };
    },
  });
  registerTool({
    name: "product.state.get",
    description: "stub state",
    kind: "read",
    input: z.object({}),
    output: z.unknown(),
    async handler() {
      return {
        bootstrap: { workspace_id },
        approvals: [
          {
            id: crypto.randomUUID(),
            run_id: "run-1",
            kind: "draft",
            reason: "Approve first email",
            payload: { message_id },
            decision: "pending",
            created_at: "2026-06-19T00:02:00.000Z",
          },
        ],
        sendTraces: [
          {
            message_id,
            person_name: "Maya Patel",
            company_name: "Acme",
            signal_title: "Acme raised a Series A",
            signal_kind: "funding",
          },
        ],
        messages: [
          {
            id: message_id,
            conversation_id,
            channel: "email",
            direction: "outbound",
            status: "sent",
            subject: "Series A timing",
            body: "Saw the Series A and the new enterprise motion.",
            sent_at: "2026-06-19T00:03:00.000Z",
            created_at: "2026-06-19T00:02:30.000Z",
            eval_score: 0.91,
            eval_passed: true,
            eval_notes: { reason: "grounded" },
            provenance: { signal_id },
          },
        ],
        outcomes: [
          {
            id: outcome_id,
            kind: "positive_reply",
            score: 1,
            conversation_id,
            attributed_message_id: message_id,
            attributed_signal_id: signal_id,
            occurred_at: "2026-06-19T00:04:00.000Z",
            recorded_at: "2026-06-19T00:04:10.000Z",
          },
        ],
      };
    },
  });
  registerTool({
    name: "product.qualified_signals.list",
    description: "stub qualified signals",
    kind: "read",
    input: z.object({
      limit: z.number().int().min(1).max(100).optional(),
    }),
    output: z.unknown(),
    async handler() {
      return {
        workspace_id,
        generated_at: "2026-06-19T00:05:00.000Z",
        stats: {
          qualified: 1,
          with_verified_contacts: 1,
          with_outreach_draft: 1,
          with_email_draft: 1,
          ready_for_review: 1,
          blocked_by_fit: 0,
        },
        signals: [
          {
            id: signal_id,
            kind: "funding",
            status: "matched",
            title: "Acme raised a Series A",
            content: "Acme is hiring its first enterprise revenue team.",
            url: "https://example.com/acme-series-a",
            match_score: 0.87,
            match_reason: "Matches founder-led SaaS expansion",
            freshness_at: "2026-06-19T00:00:00.000Z",
            ingested_at: "2026-06-19T00:00:10.000Z",
            matched_at: "2026-06-19T00:00:20.000Z",
            company: {
              id: crypto.randomUUID(),
              name: "Acme",
              domain: "acme.example",
              industry: "SaaS",
              description: "Revenue platform",
            },
            contacts: [
              {
                rank: 1,
                person_id,
                full_name: "Maya Patel",
                title: "VP Sales",
                score: 0.92,
                contact_fit_decision: "fit",
                reasons: ["gtm_leader", "verified_email"],
                emails: ["maya@acme.example"],
                linkedin_url: null,
                verification: {
                  email_verified: true,
                  email_status: "valid",
                  linkedin_ready: false,
                },
                provenance: { source: "test" },
              },
              {
                rank: 2,
                person_id: linkedin_person_id,
                full_name: "Noor Chen",
                title: "Founder",
                score: 0.88,
                contact_fit_decision: null,
                reasons: ["executive_or_founder", "linkedin_ready"],
                emails: [],
                linkedin_url: "https://www.linkedin.com/in/noorchen",
                verification: {
                  email_verified: false,
                  email_status: null,
                  linkedin_ready: true,
                },
                provenance: { source: "test" },
              },
            ],
            contact_source: "resolution",
            contact_channel: "email",
            contact_defer_reason: null,
            outreach_draft: {
              conversation_id,
              message_id,
              channel: "email",
              status: "draft",
              subject: "Series A timing",
              body: "Saw the Series A and the new enterprise motion.",
              eval_score: 0.91,
              eval_passed: true,
              external_id: null,
              scheduled_at: null,
              sent_at: null,
              delivered_at: null,
              latest_channel_event_type: null,
              latest_channel_event_at: null,
              defer_reason: null,
              defer_detail: null,
              pending_approval_id: approval_id,
              created_at: "2026-06-19T00:02:30.000Z",
            },
            email_draft: {
              conversation_id,
              message_id,
              channel: "email",
              status: "draft",
              subject: "Series A timing",
              body: "Saw the Series A and the new enterprise motion.",
              eval_score: 0.91,
              eval_passed: true,
              external_id: null,
              scheduled_at: null,
              sent_at: null,
              delivered_at: null,
              latest_channel_event_type: null,
              latest_channel_event_at: null,
              defer_reason: null,
              defer_detail: null,
              pending_approval_id: approval_id,
              created_at: "2026-06-19T00:02:30.000Z",
            },
          },
        ],
      };
    },
  });
  registerTool({
    name: "product.approval.decide",
    description: "stub approval decision",
    kind: "write",
    input: z.object({
      approval_id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      note: z.string().optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
    async handler(input) {
      approvalDecisions.push(input);
      return { ok: true };
    },
  });
  registerTool({
    name: "product.signals.dispatch_plays",
    description: "stub prepare outreach",
    kind: "write",
    input: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    output: z.object({ dispatched: z.number().int().nonnegative() }),
    async handler(input) {
      dispatchCalls.push(input);
      return { dispatched: 1 };
    },
  });
  registerBombsellAliasTools();

  const brief = await invokeTool<{ source_tool: string; windows: { last_24h: { qualified_signals: number } } }>(
    "bombsell.brief.get",
    {},
    { workspace_id, user_id },
  );
  assert.equal(brief.source_tool, "product.brief.get");
  assert.equal(brief.windows.last_24h.qualified_signals, 3);

  const readiness = await invokeTool<{ launch_ready: boolean; checks: Array<{ surface: string | null }> }>(
    "bombsell.launch.check",
    { required_channel: "both" },
    { workspace_id, user_id },
  );
  assert.equal(readiness.launch_ready, true);
  assert.equal(readiness.checks[0]?.surface, "/dashboard/profile#channels");

  const profileProposal = await invokeTool<{
    mode: string;
    profile_patch: {
      company_name: string | null;
      website_url: string | null;
      value_proposition: string | null;
      signal_keywords: string | null;
      linkedin_signal_behaviors: string | null;
    };
    icp_draft: {
      signal_kind: string;
      nice_to_haves: string[];
    };
    source_recommendations: Array<{ kind: string; value: string }>;
    apply_plan: Array<{
      tool_name: string;
      requires_confirmation: boolean;
      input: Record<string, unknown>;
    }>;
    missing_context: string[];
    existing_context_excerpt: string | null;
    source_tool: string;
  }>(
    "bombsell.profile.propose_from_context",
    {
      repo_context:
        "Acme turns product and funding signals into verified email and LinkedIn outreach.",
      company_name: "Acme",
      website_url: "https://acme.example",
      value_proposition: "Turns quality signals into verified outreach.",
      customer_pain_points: "Teams miss buying intent and lack verified contacts.",
      target_titles: "VP of Sales\nHead of Growth",
      target_markets: "North America\nB2B SaaS",
      signal_keywords: "funding\nlinkedin prospecting",
      linkedin_signal_behaviors:
        "Company and team engagement\nKeyworded post likes and comments",
      integrations: ["Outlook", "LinkedIn"],
    },
    { workspace_id, user_id },
  );
  assert.equal(profileProposal.mode, "proposal_only");
  assert.equal(profileProposal.profile_patch.company_name, "Acme");
  assert.equal(profileProposal.profile_patch.website_url, "https://acme.example");
  assert.equal(
    profileProposal.profile_patch.value_proposition,
    "Turns quality signals into verified outreach.",
  );
  assert.equal(
    profileProposal.profile_patch.linkedin_signal_behaviors,
    "Company and team engagement Keyworded post likes and comments",
  );
  assert.equal(profileProposal.icp_draft.signal_kind, "funding");
  assert.deepEqual(profileProposal.icp_draft.nice_to_haves.slice(0, 2), [
    "funding",
    "linkedin prospecting",
  ]);
  assert.ok(
    profileProposal.icp_draft.nice_to_haves.some((item) =>
      item.includes("LinkedIn behavior: Company and team engagement"),
    ),
  );
  assert.ok(
    profileProposal.source_recommendations.some(
      (source) => source.kind === "linkedin_behavior",
    ),
  );
  assert.equal(profileProposal.source_recommendations[0]?.kind, "website");
  assert.equal(profileProposal.source_recommendations[0]?.value, "https://acme.example");
  assert.equal(profileProposal.apply_plan[0]?.tool_name, "product.company.profile.configure");
  assert.equal(profileProposal.apply_plan[0]?.requires_confirmation, true);
  assert.equal(profileProposal.apply_plan[1]?.tool_name, "product.icp.configure");
  assert.deepEqual(profileProposal.missing_context, []);
  assert.match(profileProposal.existing_context_excerpt ?? "", /current workspace context/);
  assert.equal(profileProposal.source_tool, "product.context.get");

  const outreach = await invokeTool<{ outreach: Array<{ message_id: string; person_name: string | null; href: string }> }>(
    "bombsell.outreach.list_sent",
    {},
    { workspace_id, user_id },
  );
  assert.equal(outreach.outreach[0]?.message_id, message_id);
  assert.equal(outreach.outreach[0]?.person_name, "Maya Patel");
  assert.match(outreach.outreach[0]?.href ?? "", /\/dashboard\/agent\/outreach\//);

  const signals = await invokeTool<{
    stats: { qualified: number };
    signals: Array<{
      signal_id: string;
      contact_counts: {
        email_verified: number;
        linkedin_ready: number;
        needs_fit_review: number;
      };
      contacts: Array<{ full_name: string; email_verified: boolean; linkedin_ready: boolean; emails?: string[] }>;
      outreach_draft: { pending_approval_id: string | null } | null;
    }>;
  }>(
    "bombsell.signals.list_qualified",
    {},
    { workspace_id, user_id },
  );
  assert.equal(signals.stats.qualified, 1);
  assert.equal(signals.signals[0]?.signal_id, signal_id);
  assert.equal(signals.signals[0]?.contact_counts.email_verified, 1);
  assert.equal(signals.signals[0]?.contact_counts.linkedin_ready, 1);
  assert.equal(signals.signals[0]?.contact_counts.needs_fit_review, 1);
  assert.equal(signals.signals[0]?.contacts[0]?.full_name, "Maya Patel");
  assert.equal(signals.signals[0]?.contacts[0]?.email_verified, true);
  assert.equal(signals.signals[0]?.contacts[1]?.linkedin_ready, true);
  assert.equal(signals.signals[0]?.contacts[0]?.emails, undefined);
  assert.equal(signals.signals[0]?.outreach_draft?.pending_approval_id, approval_id);

  const lanes = await invokeTool<{
    lane_counts: {
      email_verified: number;
      linkedin_ready: number;
      draft_ready: number;
      needs_contact_resolution: number;
      needs_fit_review: number;
    };
  }>(
    "bombsell.contact_lanes.get",
    {},
    { workspace_id, user_id },
  );
  assert.equal(lanes.lane_counts.email_verified, 1);
  assert.equal(lanes.lane_counts.linkedin_ready, 1);
  assert.equal(lanes.lane_counts.draft_ready, 1);
  assert.equal(lanes.lane_counts.needs_contact_resolution, 0);
  assert.equal(lanes.lane_counts.needs_fit_review, 1);

  const integrations = await invokeTool<{
    native_channels_ready: number;
    launch_ready: boolean;
    next_action: { href: string };
    destinations: Array<{
      key: string;
      status: string;
      handoff_stage: string;
      tools: string[];
    }>;
    source_tools: string[];
  }>(
    "bombsell.integrations.list",
    {},
    { workspace_id, user_id },
  );
  assert.equal(integrations.native_channels_ready, 2);
  assert.equal(integrations.launch_ready, true);
  assert.equal(integrations.next_action.href, "/dashboard/profile#tools");
  assert.deepEqual(integrations.source_tools, [
    "product.brief.get",
    "product.launch.readiness.get",
  ]);
  assert.equal(
    integrations.destinations.find((item) => item.key === "outlook")?.status,
    "connected",
  );
  assert.equal(
    integrations.destinations.find((item) => item.key === "linkedin")?.status,
    "connected",
  );
  assert.equal(
    integrations.destinations.find((item) => item.key === "claude-code")
      ?.handoff_stage,
    "agent_api",
  );
  assert.deepEqual(
    integrations.destinations.find((item) => item.key === "signal-webhook")
      ?.tools,
    ["product.signal.submit"],
  );
  assert.equal(
    integrations.destinations.find((item) => item.key === "crm-sync")?.status,
    "planned",
  );
  assert.equal(
    integrations.destinations.find((item) => item.key === "team-alerts")
      ?.handoff_stage,
    "reply_meeting_alert",
  );

  await assert.rejects(
    invokeTool(
      "bombsell.outreach.prepare",
      { limit: 3 },
      { workspace_id, user_id },
    ),
    /confirm_prepare=true/,
  );
  assert.equal(dispatchCalls.length, 0);

  const prepared = await invokeTool<{
    dispatched: number;
    requested_limit: number;
    before: { ready_for_review: number };
    after: { with_outreach_draft: number };
    review_ready_signals: Array<{
      signal_id: string;
      outreach_draft: { pending_approval_id: string | null } | null;
    }>;
    next_action: { href: string };
    source_tool: string;
  }>(
    "bombsell.outreach.prepare",
    { limit: 3, confirm_prepare: true },
    { workspace_id, user_id },
  );
  assert.equal(prepared.dispatched, 1);
  assert.equal(prepared.requested_limit, 3);
  assert.equal(prepared.before.ready_for_review, 1);
  assert.equal(prepared.after.with_outreach_draft, 1);
  assert.equal(prepared.review_ready_signals[0]?.signal_id, signal_id);
  assert.equal(
    prepared.review_ready_signals[0]?.outreach_draft?.pending_approval_id,
    approval_id,
  );
  assert.equal(prepared.next_action.href, "/dashboard/agent#review-queue");
  assert.equal(prepared.source_tool, "product.signals.dispatch_plays");
  assert.deepEqual(dispatchCalls, [{ limit: 3 }]);

  const draft = await invokeTool<{ message: { body: string | null; eval_passed: boolean | null } | null }>(
    "bombsell.draft.get",
    { message_id },
    { workspace_id, user_id },
  );
  assert.equal(draft.message?.body, "Saw the Series A and the new enterprise motion.");
  assert.equal(draft.message?.eval_passed, true);

  const approvals = await invokeTool<{ pending_count: number; approvals: Array<{ payload_keys: string[] }> }>(
    "bombsell.approvals.list",
    {},
    { workspace_id, user_id },
  );
  assert.equal(approvals.pending_count, 1);
  assert.deepEqual(approvals.approvals[0]?.payload_keys, ["message_id"]);

  await assert.rejects(
    invokeTool(
      "bombsell.approvals.decide",
      { approval_id, decision: "approved" },
      { workspace_id, user_id },
    ),
    /confirm_channel_effects=true/,
  );
  assert.equal(approvalDecisions.length, 0);

  const approved = await invokeTool<{
    ok: boolean;
    approval_id: string;
    decision: string;
    next_action: string;
    source_tool: string;
  }>(
    "bombsell.approvals.decide",
    {
      approval_id,
      decision: "approved",
      note: "Looks grounded.",
      confirm_channel_effects: true,
    },
    { workspace_id, user_id },
  );
  assert.equal(approved.ok, true);
  assert.equal(approved.approval_id, approval_id);
  assert.equal(approved.decision, "approved");
  assert.equal(approved.next_action, "inspect_agent");
  assert.equal(approved.source_tool, "product.approval.decide");
  assert.deepEqual(approvalDecisions[0], {
    approval_id,
    decision: "approved",
    note: "Looks grounded.",
  });

  const rejected = await invokeTool<{ ok: boolean; next_action: string }>(
    "bombsell.approvals.decide",
    { approval_id: rejected_approval_id, decision: "rejected", note: "Too vague." },
    { workspace_id, user_id },
  );
  assert.equal(rejected.ok, true);
  assert.equal(rejected.next_action, "refresh_approvals");

  const learning = await invokeTool<{ useful_outcome_count: number; counts_by_kind: Record<string, number> }>(
    "bombsell.learning.get",
    {},
    { workspace_id, user_id },
  );
  assert.equal(learning.useful_outcome_count, 1);
  assert.equal(learning.counts_by_kind.positive_reply, 1);
});
