import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createConfirmationToken,
  verifyConfirmationToken,
} from "../core/product/assistant/policy.ts";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

test("assistant confirmation tokens round-trip for the same user and workspace", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret";

  try {
    const token = createConfirmationToken({
      toolName: "dispatch_outreach",
      input: { limit: 2 },
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    assert.deepEqual(verifyConfirmationToken(token, {
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    }), {
      exp: verifyConfirmationToken(token, {
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
      }).exp,
      input: { limit: 2 },
      tool_name: "dispatch_outreach",
      user_id: USER_ID,
      workspace_id: WORKSPACE_ID,
    });
  } finally {
    if (previous === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previous;
    }
  }
});

test("assistant confirmation tokens reject mismatched scopes and expired payloads", () => {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-secret";

  try {
    const token = createConfirmationToken({
      toolName: "retry_failed_workflow",
      input: { run_id: "33333333-3333-4333-8333-333333333333" },
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      ttlMs: -1,
    });

    assert.throws(
      () =>
        verifyConfirmationToken(token, {
          userId: USER_ID,
          workspaceId: "44444444-4444-4444-8444-444444444444",
        }),
      /active workspace/,
    );
    assert.throws(
      () =>
        verifyConfirmationToken(token, {
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
        }),
      /Confirmation expired/,
    );
  } finally {
    if (previous === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previous;
    }
  }
});
