import { test } from "node:test";
import assert from "node:assert/strict";
import { activeWorkspaceLookup } from "../lib/workspace-selection.ts";

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
