import { test } from "node:test";
import assert from "node:assert/strict";
import {
  moduleForTarget,
  resolveWorkerHealthPort,
} from "../scripts/managed-worker-config.ts";

test("managed worker config resolves every supported target module", () => {
  assert.equal(moduleForTarget("worker:production"), "./production-worker.ts");
  assert.equal(moduleForTarget("worker:email-projectors"), "./email-projectors-worker.ts");
  assert.equal(moduleForTarget("worker:signal-projectors"), "./signal-projectors-worker.ts");
  assert.equal(moduleForTarget("worker:projectors"), "./projectors-worker.ts");
  assert.equal(moduleForTarget("worker:restate-workflows"), "./restate-workflows-worker.ts");
  assert.throws(() => moduleForTarget("worker:nope"), /WORKER_TARGET_COMMAND/);
});

test("managed worker config avoids Restate handler port collisions by default", () => {
  assert.equal(resolveWorkerHealthPort("worker:email-projectors", {}), 9080);
  assert.equal(resolveWorkerHealthPort("worker:production", {}), 9081);
  assert.equal(resolveWorkerHealthPort("worker:restate-workflows", {}), 9081);
});

test("managed worker config rejects health port collisions for Restate-capable workers", () => {
  assert.throws(
    () =>
      resolveWorkerHealthPort("worker:production", {
        WORKER_HEALTH_PORT: "9080",
        RESTATE_WORKFLOW_PORT: "9080",
      }),
    /must differ/,
  );
  assert.equal(
    resolveWorkerHealthPort("worker:production", {
      WORKER_HEALTH_PORT: "9090",
      RESTATE_WORKFLOW_PORT: "9080",
    }),
    9090,
  );
});
