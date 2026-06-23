import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessWorkspaceIsolation,
  runWorkspaceIsolationProbe,
} from "../scripts/verify-workspace-isolation.ts";

test("workspace isolation probe passes when users are distinct and migrated off default", () => {
  const result = assessWorkspaceIsolation({
    duplicateEmails: [],
    sharedDefaultWorkspace: {
      accepted_members: 1,
      non_owner_members: 0,
    },
    legacyUsersNeedingMigration: [],
    totalUsers: 3,
    distinctEmails: 3,
    sharedNonDefaultWorkspaces: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.steps.every((step) => step.status === "ok"), true);
});

test("workspace isolation probe fails when legacy users still share the default workspace", () => {
  const result = assessWorkspaceIsolation({
    duplicateEmails: [],
    sharedDefaultWorkspace: {
      accepted_members: 11,
      non_owner_members: 10,
    },
    legacyUsersNeedingMigration: [
      {
        email: "friend@example.com",
        default_memberships: 1,
        non_default_memberships: 0,
      },
      {
        email: "second@example.com",
        default_memberships: 1,
        non_default_memberships: 0,
      },
    ],
    totalUsers: 13,
    distinctEmails: 13,
    sharedNonDefaultWorkspaces: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.steps.find((step) => step.label === "workspace isolation: shared default workspace retired")?.status,
    "fail",
  );
  assert.equal(
    result.steps.find((step) => step.label === "workspace isolation: legacy users migrated")?.status,
    "fail",
  );
});

test("workspace isolation probe fails when DATABASE_URL is unavailable", async () => {
  const result = await runWorkspaceIsolationProbe({ env: {} });

  assert.equal(result.ok, false);
  assert.equal(
    result.steps.find((step) => step.label === "workspace isolation: database configured")?.status,
    "fail",
  );
});
