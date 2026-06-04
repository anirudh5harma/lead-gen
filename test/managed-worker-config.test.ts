import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test(".env.example keeps Restate-capable managed workers on the safe health default", () => {
  const env = parseExampleEnv();
  assert.equal(env.RESTATE_WORKFLOW_PORT, "9080");
  assert.equal(env.WORKER_HEALTH_PORT, "");
  assert.equal(resolveWorkerHealthPort("worker:production", env), 9081);
});

function parseExampleEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of readFileSync(new URL("../.env.example", import.meta.url), "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 0) continue;
    env[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return env;
}
