import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("billing routes gate portal and checkout behind workspace billing access", () => {
  const portal = readFileSync("app/api/billing/portal/route.ts", "utf8");
  const checkout = readFileSync("app/api/billing/pro/checkout/route.ts", "utf8");

  assert.match(portal, /canUseWorkspaceOps/);
  assert.match(portal, /owner or admin role/);
  assert.match(checkout, /canUseWorkspaceOps/);
  assert.match(checkout, /owner or admin role/);
});

test("visitor collector requires a bound public host before accepting browser traffic", () => {
  const collector = readFileSync("app/api/collect/visitors/route.ts", "utf8");
  const dashboardActions = readFileSync("app/dashboard/actions.ts", "utf8");
  const productApp = readFileSync("core/product/app.ts", "utf8");

  assert.match(collector, /if \(allowed\.length === 0\) return false/);
  assert.match(collector, /publicHostMatches/);
  assert.match(dashboardActions, /Add a public website or company domain/);
  assert.match(productApp, /provider === "bombsell_script"/);
  assert.match(productApp, /allowed_origins/);
});
