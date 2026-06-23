import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("health readiness route requires authenticated workspace ops access", () => {
  const body = readFileSync("app/api/health/readiness/route.ts", "utf8");

  assert.match(body, /getActiveWorkspaceSession/);
  assert.match(body, /canUseWorkspaceOps/);
  assert.match(body, /authentication required/);
  assert.match(body, /workspace operations access required/);
  assert.match(body, /checkProductReadinessCached/);
});

test("next config applies baseline browser hardening headers", () => {
  const body = readFileSync("next.config.ts", "utf8");

  assert.match(body, /Referrer-Policy/);
  assert.match(body, /X-Content-Type-Options/);
  assert.match(body, /X-Frame-Options/);
});
