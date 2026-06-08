import assert from "node:assert/strict";
import test from "node:test";
import { isStaleRestateApprovalResolutionError } from "../core/product/app.ts";

test("approval decisions: Restate bad awakeable errors are classified as stale approval rows", () => {
  assert.equal(
    isStaleRestateApprovalResolutionError({
      status: 400,
      body: "{\"message\":\"bad awakeable id '69b3080c-e0e4-4a0a-a4a2-7a6dfea2bea2': bad format\"}",
    }),
    true,
  );
});

test("approval decisions: unrelated Restate errors still surface", () => {
  assert.equal(
    isStaleRestateApprovalResolutionError({
      status: 400,
      body: "{\"message\":\"invalid request body\"}",
    }),
    false,
  );
  assert.equal(
    isStaleRestateApprovalResolutionError({
      status: 500,
      body: "{\"message\":\"restate unavailable\"}",
    }),
    false,
  );
});
