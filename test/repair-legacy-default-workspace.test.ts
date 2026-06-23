import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRepairPlan } from "../scripts/repair-legacy-default-workspace.ts";

test("repair plan renames the owner workspace from the company profile and seeds isolated workspaces", () => {
  const plan = buildRepairPlan({
    defaultWorkspace: {
      id: "ws-default",
      slug: "default",
      name: "Default Workspace",
      plan: "pro",
      settings: {
        billing_override: {
          active: true,
          tier: "pro",
          source: "legacy_launch_plan",
        },
      },
    },
    existingSlugs: ["default", "aankit-workspace"],
    legacyMembers: [
      {
        accepted_at: "2026-01-01T00:00:00.000Z",
        email: "owner@example.com",
        role: "owner",
        user_id: "owner-user",
        has_channel_account: true,
        has_event_activity: true,
        has_tracked_company: true,
        has_decision_activity: true,
      },
      {
        accepted_at: "2026-01-01T00:00:00.000Z",
        email: "aankit@example.com",
        role: "member",
        user_id: "member-user",
        has_channel_account: false,
        has_event_activity: false,
        has_tracked_company: false,
        has_decision_activity: false,
      },
    ],
    ownerProfile: {
      company_name: "Bombsell",
      company_domain: "bombsell.com",
      website_url: "https://bombsell.com",
    },
    ownerNonDefaultWorkspaceCount: 0,
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.summary?.ownerTargetName, "Bombsell GTM");
  assert.equal(plan.summary?.ownerTargetSlug, "bombsell");
  assert.equal(plan.workspaceCreations[0]?.slug, "aankit-workspace-2");
  assert.deepEqual(plan.workspaceCreations[0]?.settings.billing_override, {
    active: true,
    tier: "pro",
    source: "legacy_launch_plan",
  });
});

test("repair plan blocks when a non-owner still shows ownership activity", () => {
  const plan = buildRepairPlan({
    defaultWorkspace: {
      id: "ws-default",
      slug: "default",
      name: "Default Workspace",
      plan: "pro",
      settings: {},
    },
    existingSlugs: ["default"],
    legacyMembers: [
      {
        accepted_at: "2026-01-01T00:00:00.000Z",
        email: "owner@example.com",
        role: "owner",
        user_id: "owner-user",
        has_channel_account: true,
        has_event_activity: true,
        has_tracked_company: true,
        has_decision_activity: true,
      },
      {
        accepted_at: "2026-01-01T00:00:00.000Z",
        email: "friend@example.com",
        role: "member",
        user_id: "friend-user",
        has_channel_account: false,
        has_event_activity: true,
        has_tracked_company: false,
        has_decision_activity: false,
      },
    ],
    ownerProfile: null,
    ownerNonDefaultWorkspaceCount: 0,
  });

  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0] ?? "", /Non-owner legacy members still show ownership signals/);
});

test("repair plan blocks when the owner already has a non-default workspace", () => {
  const plan = buildRepairPlan({
    defaultWorkspace: {
      id: "ws-default",
      slug: "default",
      name: "Default Workspace",
      plan: "pro",
      settings: {},
    },
    existingSlugs: ["default"],
    legacyMembers: [
      {
        accepted_at: "2026-01-01T00:00:00.000Z",
        email: "owner@example.com",
        role: "owner",
        user_id: "owner-user",
        has_channel_account: true,
        has_event_activity: true,
        has_tracked_company: true,
        has_decision_activity: true,
      },
    ],
    ownerProfile: null,
    ownerNonDefaultWorkspaceCount: 1,
  });

  assert.equal(plan.ok, false);
  assert.match(plan.blockers[0] ?? "", /already has 1 non-default accepted workspace/);
});
