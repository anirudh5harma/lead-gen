import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  listTools,
  _resetToolRegistry,
} from "../core/agents/tools/registry.ts";
import {
  registerProductTools,
  _resetProductToolsRegistration,
} from "../core/product/tools.ts";

beforeEach(() => {
  _resetToolRegistry();
  _resetProductToolsRegistration();
});

test("product tools: registerProductTools exposes current UI actions to agents", () => {
  registerProductTools();
  const names = new Set(listTools().map((tool) => tool.name));

  for (const expected of [
    "product.state.get",
    "product.company.website_profile.extract",
    "product.company.profile.configure",
    "product.rep.configure",
    "product.icp.configure",
    "product.play.signal_email.configure",
    "product.email_account.configure",
    "product.company.track",
    "product.source.configure",
    "product.activation.configure",
    "product.sources.default_aggregator.configure",
    "product.sources.aggregate.run",
    "product.signal.discover",
    "product.signal.submit",
    "product.signals.dispatch_plays",
    "product.approval.decide",
    "product.workflow.retry",
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
