import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

test("Agent opportunity review lookup uses indexed pending approval message lookup", () => {
  const page = readFileSync(join(root, "core/product/qualified-signals.ts"), "utf8");
  const migration = readFileSync(join(root, "db/migrations/037_workflow_approval_message_lookup.sql"), "utf8");

  assert.match(page, /a\.payload->>'message_id' = m\.id::text/);
  assert.match(page, /a\.payload \? 'message_id'/);
  assert.doesNotMatch(page, /\(a\.payload->>'message_id'\)::uuid = m\.id/);
  assert.match(migration, /workflow_approvals_pending_message_idx/);
  assert.match(migration, /workspace_id, \(payload->>'message_id'\), created_at desc/);
});

test("review message join stays scoped to the approval workspace", () => {
  const page = readFileSync(join(root, "app/dashboard/review/page.tsx"), "utf8");

  assert.match(page, /m\.workspace_id = a\.workspace_id/);
  assert.match(page, /m\.id = \(a\.payload->>'message_id'\)::uuid/);
});
