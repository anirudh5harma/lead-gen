import assert from "node:assert/strict";
import { test } from "node:test";
import { runOutreachPipelineProbe } from "../scripts/verify-outreach-pipeline.ts";

test("outreach pipeline probe: local mode verifies pipeline and warns on missing Outlook", async () => {
  const result = await runOutreachPipelineProbe({ env: {} });

  assert.equal(result.ok, true);
  assert.equal(result.strict, false);
  assert.equal(
    result.steps.find((step) => step.name === "connected_outlook_inbox")?.status,
    "warn",
  );
  assert.equal(
    result.steps.find((step) => step.name === "top_three_contact_resolution")?.status,
    "ok",
  );
  assert.equal(
    result.steps.find((step) => step.name === "provider_waterfall_contact_resolution")?.status,
    "ok",
  );
  assert.equal(
    result.steps.find((step) => step.name === "personalized_email_context")?.status,
    "ok",
  );
  assert.equal(
    result.steps.find((step) => step.name === "hot_path_eval_gate")?.status,
    "ok",
  );
});

test("outreach pipeline probe: strict mode fails without Outlook readiness", async () => {
  const result = await runOutreachPipelineProbe({
    strict: true,
    env: {},
    includeLocalPipeline: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.strict, true);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.name, "connected_outlook_inbox");
  assert.equal(result.steps[0]?.status, "fail");
});

test("outreach pipeline probe: strict mode accepts healthy Outlook readiness", async () => {
  const result = await runOutreachPipelineProbe({
    strict: true,
    env: { DATABASE_URL: "postgresql://example" },
    includeLocalPipeline: false,
    outlookPool: {
      query: async () => ({
        rows: [{
          total_outlook: "1",
          connected_outlook: "1",
          active_subscriptions: "1",
          errored_connected: "0",
          connected_managed_domains: "0",
        }],
      }),
      end: async () => undefined,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.strict, true);
  assert.equal(result.steps[0]?.status, "ok");
});

test("outreach pipeline probe: live provider smoke is opt-in and reports success", async () => {
  const result = await runOutreachPipelineProbe({
    env: { DATABASE_URL: "postgresql://example" },
    includeLocalPipeline: false,
    liveProviderSmoke: true,
    liveProviderRunner: async () => ({
      decision: "resolved",
      candidateNames: ["Ava Founder", "Ben Revenue", "Cara Growth"],
      selectedPersonId: "person_1",
      providerOrder: ["graph_cache", "exa.people_search", "hunter.email_verifier"],
      verifiedCount: 3,
      keptWorkspaceId: null,
    }),
    outlookPool: {
      query: async () => ({
        rows: [{
          total_outlook: "1",
          connected_outlook: "1",
          active_subscriptions: "1",
          errored_connected: "0",
          connected_managed_domains: "0",
        }],
      }),
      end: async () => undefined,
    },
  });

  const live = result.steps.find((step) => step.name === "live_provider_contact_resolution");
  assert.equal(result.ok, true);
  assert.equal(live?.status, "ok");
  assert.match(live?.detail ?? "", /Ava Founder/);
  assert.match(live?.detail ?? "", /3 verified email/);
});

test("outreach pipeline probe: live provider smoke failures fail the probe", async () => {
  const result = await runOutreachPipelineProbe({
    env: { DATABASE_URL: "postgresql://example" },
    includeLocalPipeline: false,
    liveProviderSmoke: true,
    liveProviderRunner: async () => {
      throw new Error("provider credentials rejected");
    },
    outlookPool: {
      query: async () => ({
        rows: [{
          total_outlook: "1",
          connected_outlook: "1",
          active_subscriptions: "1",
          errored_connected: "0",
          connected_managed_domains: "0",
        }],
      }),
      end: async () => undefined,
    },
  });

  const live = result.steps.find((step) => step.name === "live_provider_contact_resolution");
  assert.equal(result.ok, false);
  assert.equal(live?.status, "fail");
  assert.match(live?.detail ?? "", /provider credentials rejected/);
});

test("outreach pipeline probe: live provider smoke requires three verified contacts", async () => {
  const result = await runOutreachPipelineProbe({
    env: { DATABASE_URL: "postgresql://example" },
    includeLocalPipeline: false,
    liveProviderSmoke: true,
    liveProviderRunner: async () => ({
      decision: "resolved",
      candidateNames: ["Ava Founder"],
      selectedPersonId: "person_1",
      providerOrder: ["graph_cache", "exa.people_search"],
      verifiedCount: 1,
      keptWorkspaceId: null,
    }),
    outlookPool: {
      query: async () => ({
        rows: [{
          total_outlook: "1",
          connected_outlook: "1",
          active_subscriptions: "1",
          errored_connected: "0",
          connected_managed_domains: "0",
        }],
      }),
      end: async () => undefined,
    },
  });

  const live = result.steps.find((step) => step.name === "live_provider_contact_resolution");
  assert.equal(result.ok, false);
  assert.equal(live?.status, "fail");
  assert.match(live?.detail ?? "", /candidates=1, verified=1/);
});
