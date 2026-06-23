import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool } from "pg";
import {
  buildWorkspaceLaunchReadiness,
  loadWorkspaceLaunchReadiness,
} from "../core/product/launch-readiness.ts";

test("launch readiness: blocks launch until setup and one channel are ready", () => {
  const workspace_id = randomUUID();
  const readiness = buildWorkspaceLaunchReadiness(
    workspace_id,
    {
      workspace_profiles: 1,
      enabled_icps: 1,
      active_reps: 1,
      enabled_sources: 0,
      active_plays: 1,
      connected_outlook: 0,
      active_outlook_subscriptions: 0,
      needs_reauth_outlook: 0,
      errored_outlook: 0,
      connected_linkedin: 0,
      rate_limited_linkedin: 0,
      needs_reauth_linkedin: 1,
      suspended_linkedin: 0,
      disconnected_linkedin: 0,
    },
    {
      activation: { website_set: true, description_set: true, product_ready: true },
      now: new Date("2026-06-15T10:00:00.000Z"),
    },
  );

  assert.equal(readiness.workspace_id, workspace_id);
  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.launch_ready, false);
  assert.equal(readiness.next_action, "configure_sources");
  assert.ok(readiness.blockers.includes("signal_sources"));
  assert.ok(readiness.blockers.includes("outreach_channel"));
  assert.ok(readiness.warnings.includes("linkedin"));
  assert.equal(readiness.checks.find((check) => check.id === "rep")?.label, "Agent");
  assert.equal(
    readiness.checks.find((check) => check.id === "plays")?.label,
    "Outreach rules",
  );
  assert.equal(
    readiness.checks.find((check) => check.id === "signal_sources")?.action?.surface,
    "/dashboard/profile#signal-setup",
  );
  assert.equal(
    readiness.checks.find((check) => check.id === "linkedin")?.status,
    "needs_attention",
  );
});

test("launch readiness: outreach rules setup points users back to Agent", () => {
  const readiness = buildWorkspaceLaunchReadiness(
    randomUUID(),
    {
      workspace_profiles: 1,
      enabled_icps: 1,
      active_reps: 1,
      enabled_sources: 1,
      active_plays: 0,
      connected_outlook: 1,
      active_outlook_subscriptions: 1,
      needs_reauth_outlook: 0,
      errored_outlook: 0,
      connected_linkedin: 0,
      rate_limited_linkedin: 0,
      needs_reauth_linkedin: 0,
      suspended_linkedin: 0,
      disconnected_linkedin: 0,
    },
    { now: new Date("2026-06-15T10:00:00.000Z") },
  );

  const path = readiness.checks.find((check) => check.id === "plays");
  assert.equal(path?.label, "Outreach rules");
  assert.equal(path?.detail, "No active email or LinkedIn outreach rules are available for qualified signals.");
  assert.equal(path?.action?.label, "Configure outreach");
  assert.equal(path?.action?.surface, "/dashboard/agent#outreach");
});

test("launch readiness: requires both channels when a Play needs both", () => {
  const readiness = buildWorkspaceLaunchReadiness(
    randomUUID(),
    {
      workspace_profiles: 1,
      enabled_icps: 2,
      active_reps: 1,
      enabled_sources: 3,
      active_plays: 2,
      connected_outlook: 1,
      active_outlook_subscriptions: 1,
      needs_reauth_outlook: 0,
      errored_outlook: 0,
      connected_linkedin: 0,
      rate_limited_linkedin: 0,
      needs_reauth_linkedin: 0,
      suspended_linkedin: 0,
      disconnected_linkedin: 0,
    },
    {
      activation: { website_set: true, description_set: true, product_ready: true },
      required_channel: "both",
      now: new Date("2026-06-15T10:00:00.000Z"),
    },
  );

  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.launch_ready, false);
  assert.deepEqual(readiness.blockers, ["linkedin", "outreach_channel"]);
  assert.equal(readiness.next_action, "connect_linkedin");
});

test("launch readiness: one healthy outreach channel can satisfy default launch", () => {
  const readiness = buildWorkspaceLaunchReadiness(
    randomUUID(),
    {
      workspace_profiles: 1,
      enabled_icps: 1,
      active_reps: 1,
      enabled_sources: 1,
      active_plays: 1,
      connected_outlook: 1,
      active_outlook_subscriptions: 1,
      needs_reauth_outlook: 0,
      errored_outlook: 0,
      connected_linkedin: 0,
      rate_limited_linkedin: 0,
      needs_reauth_linkedin: 0,
      suspended_linkedin: 0,
      disconnected_linkedin: 0,
    },
    {
      activation: { website_set: true, description_set: true, product_ready: true },
      now: new Date("2026-06-15T10:00:00.000Z"),
    },
  );

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.launch_ready, true);
  assert.equal(readiness.next_action, "start_outreach");
  assert.deepEqual(readiness.blockers, []);
  assert.ok(readiness.warnings.includes("linkedin"));
});

test("launch readiness: connected Outlook without active subscription asks for sync review, not reconnect", () => {
  const readiness = buildWorkspaceLaunchReadiness(
    randomUUID(),
    {
      workspace_profiles: 1,
      enabled_icps: 1,
      active_reps: 1,
      enabled_sources: 1,
      active_plays: 1,
      connected_outlook: 1,
      active_outlook_subscriptions: 0,
      needs_reauth_outlook: 0,
      errored_outlook: 0,
      connected_linkedin: 0,
      rate_limited_linkedin: 0,
      needs_reauth_linkedin: 0,
      suspended_linkedin: 0,
      disconnected_linkedin: 0,
    },
    { now: new Date("2026-06-15T10:00:00.000Z") },
  );

  const outlook = readiness.checks.find((check) => check.id === "outlook");
  assert.equal(outlook?.status, "needs_attention");
  assert.match(outlook?.detail ?? "", /backend Graph subscription repair/);
  assert.equal(outlook?.action?.label, "Review Outlook sync");
});

test("launch readiness: blocks on workspace profile until website + description exist", () => {
  const ready = {
    workspace_profiles: 1,
    enabled_icps: 1,
    active_reps: 1,
    enabled_sources: 1,
    active_plays: 1,
    connected_outlook: 1,
    active_outlook_subscriptions: 1,
    needs_reauth_outlook: 0,
    errored_outlook: 0,
    connected_linkedin: 0,
    rate_limited_linkedin: 0,
    needs_reauth_linkedin: 0,
    suspended_linkedin: 0,
    disconnected_linkedin: 0,
  };
  const now = new Date("2026-06-15T10:00:00.000Z");

  // Website set but no description yet → still blocked on the profile gate.
  const partial = buildWorkspaceLaunchReadiness(randomUUID(), ready, {
    activation: { website_set: true, description_set: false, product_ready: false },
    now,
  });
  assert.equal(partial.status, "blocked");
  assert.equal(partial.next_action, "configure_profile");
  assert.ok(partial.blockers.includes("workspace_profile"));

  // Website + description → profile gate clears and launch is ready.
  const productReady = buildWorkspaceLaunchReadiness(randomUUID(), ready, {
    activation: { website_set: true, description_set: true, product_ready: true },
    now,
  });
  assert.equal(productReady.launch_ready, true);
  assert.ok(!productReady.blockers.includes("workspace_profile"));
});

test("launch readiness: loader uses the workspace-scoped launch query", async () => {
  let sql = "";
  const pool = {
    async query<T>(query: string) {
      // The launch loader also reads workspace activation state from
      // graph_companies; return a product-ready company for that query.
      if (query.includes("as website_url")) {
        return {
          rows: [{
            website_url: "https://acme.test",
            description: "Acme builds GTM tooling.",
          }] as T[],
        };
      }
      sql = query;
      return {
        rows: [{
          workspace_profiles: "1",
          enabled_icps: "1",
          active_reps: "1",
          enabled_sources: "1",
          active_plays: "1",
          connected_outlook: "0",
          active_outlook_subscriptions: "0",
          needs_reauth_outlook: "0",
          errored_outlook: "0",
          connected_linkedin: "1",
          rate_limited_linkedin: "0",
          needs_reauth_linkedin: "0",
          suspended_linkedin: "0",
          disconnected_linkedin: "0",
        }] as T[],
      };
    },
  } as unknown as Pool;

  const readiness = await loadWorkspaceLaunchReadiness(
    pool,
    "00000000-0000-4000-8000-000000000001",
    { required_channel: "linkedin" },
  );

  assert.equal(readiness.launch_ready, true);
  assert.match(sql, /properties->>'profile_role' = 'workspace_company'/);
  assert.match(sql, /workspace_icps/);
  assert.match(sql, /workspace_source_configs/);
  assert.match(sql, /kind = 'oauth_outlook'/);
  assert.match(sql, /outlook_mailboxes/);
  assert.match(sql, /has_needs_reauth and not has_connected/);
  assert.match(sql, /kind in \('linkedin_session','linkedin_oauth'\)/);
});
