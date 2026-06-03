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
    "product.context.get",
    "product.readiness.get",
    "product.conversation.trust.get",
    "product.company.website_profile.extract",
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
    "product.email_account.configure",
    "product.linkedin_account.connect_url.get",
    "product.company.track",
    "product.source.configure",
    "product.activation.configure",
    "product.sources.default_aggregator.configure",
    "product.signal.discover_open_web",
    "product.content.opportunities.discover",
    "product.aeo.audit",
    "product.sources.aggregate.run",
    "product.signal.discover",
    "product.signal.submit",
    "product.signals.dispatch_plays",
    "product.approval.decide",
    "product.workflow.retry",
    "product.event_dispatch.dead_letters.list",
    "product.event_dispatch.redrive",
    "product.sending_domain.operate",
  ]) {
    assert.ok(names.has(expected), `expected product tool ${expected}`);
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
