import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeWorkspaceLookup,
  workspaceAccessLookup,
} from "../lib/workspace-selection.ts";
import { setupPg } from "./_pg.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

test("active workspace lookup prefers a valid selected workspace without filtering out fallbacks", () => {
  const lookup = activeWorkspaceLookup(USER_ID, WORKSPACE_ID);

  assert.deepEqual(lookup.params, [USER_ID, WORKSPACE_ID]);
  assert.match(lookup.sql, /where wm\.user_id = \$1/);
  assert.doesNotMatch(lookup.sql, /and w\.id = \$2/);
  assert.match(lookup.sql, /case when w\.id = \$2 then 0 else 1 end/);
});

test("active workspace lookup uses newest accepted workspace when no selection exists", () => {
  const lookup = activeWorkspaceLookup(USER_ID, null);

  assert.deepEqual(lookup.params, [USER_ID]);
  assert.doesNotMatch(lookup.sql, /\$2/);
  assert.match(lookup.sql, /order by\s+w\.created_at desc, w\.id desc/);
});

test("active workspace lookup excludes the legacy shared default workspace for non-owner members", () => {
  const lookup = activeWorkspaceLookup(USER_ID, null);

  assert.match(lookup.sql, /w\.slug = 'default'/);
  assert.match(lookup.sql, /wm\.role <> 'owner'/);
  assert.match(lookup.sql, /legacy_wm\.workspace_id = w\.id/);
});

test("workspace access hides the legacy shared default workspace from non-owner members", async (t) => {
  const fx = await setupPg("workspace_access_legacy_default");
  if (!fx) return t.skip("DATABASE_URL not set");

  try {
    const defaultWorkspaceId = "33333333-3333-4333-8333-333333333333";
    const ownerId = "44444444-4444-4444-8444-444444444444";
    await fx.pool.query(
      `insert into workspaces (id, slug, name, settings)
       values ($1, 'default', 'Default Workspace', '{}'::jsonb)`,
      [defaultWorkspaceId],
    );
    await fx.pool.query(
      `insert into workspace_members (workspace_id, user_id, role, accepted_at)
       values ($1, $2, 'member', now()),
              ($1, $3, 'owner', now())`,
      [defaultWorkspaceId, USER_ID, ownerId],
    );

    const memberLookup = workspaceAccessLookup(defaultWorkspaceId, USER_ID);
    const ownerLookup = workspaceAccessLookup(defaultWorkspaceId, ownerId);
    const member = await fx.pool.query<{ ok: boolean }>(memberLookup.sql, memberLookup.params);
    const owner = await fx.pool.query<{ ok: boolean }>(ownerLookup.sql, ownerLookup.params);

    assert.equal(member.rows[0]?.ok, false);
    assert.equal(owner.rows[0]?.ok, true);
  } finally {
    await fx.close();
  }
});
