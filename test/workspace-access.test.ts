import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseWorkspaceOps, type WorkspaceRole } from "../lib/workspace-access.ts";

function session(role: WorkspaceRole) {
  return {
    role,
    user_id: "00000000-0000-4000-8000-000000000001",
    workspace: {
      id: "00000000-0000-4000-8000-000000000002",
      slug: "demo",
      name: "Demo",
    },
  };
}

test("workspace ops access is limited to owners and admins", () => {
  assert.equal(canUseWorkspaceOps(session("owner")), true);
  assert.equal(canUseWorkspaceOps(session("admin")), true);
  assert.equal(canUseWorkspaceOps(session("member")), false);
});
