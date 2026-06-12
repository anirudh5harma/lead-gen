import assert from "node:assert/strict";
import test from "node:test";
import { resolveRestateWorkflowPort } from "../scripts/worker-port.ts";

test("resolveRestateWorkflowPort prefers explicit Restate port", () => {
  assert.equal(resolveRestateWorkflowPort({
    RESTATE_WORKFLOW_PORT: "9080",
    PORT: "10000",
  }), 9080);
});

test("resolveRestateWorkflowPort falls back to provider PORT", () => {
  assert.equal(resolveRestateWorkflowPort({
    PORT: "10000",
  }), 10000);
});

test("resolveRestateWorkflowPort defaults to 9080", () => {
  assert.equal(resolveRestateWorkflowPort({}), 9080);
});

test("resolveRestateWorkflowPort rejects invalid ports", () => {
  assert.throws(
    () => resolveRestateWorkflowPort({ PORT: "nope" }),
    /PORT must be an integer port between 1 and 65535/,
  );
});
