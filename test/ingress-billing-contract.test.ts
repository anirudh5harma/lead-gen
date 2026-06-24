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
  assert.match(collector, /MAX_BROWSER_VISITOR_PAYLOAD_BYTES/);
  assert.match(collector, /publicHostMatches/);
  assert.match(collector, /const host = hostFromUnknown\(origin\)/);
  assert.doesNotMatch(collector, /hostFromUnknown\(payload\.page_url\)/);
  assert.doesNotMatch(collector, /hostFromUnknown\(payload\.referrer\)/);
  assert.doesNotMatch(collector, /hostFromUnknown\(payload\.website_url\)/);
  assert.match(dashboardActions, /Add a public website or company domain/);
  assert.match(productApp, /provider === "bombsell_script"/);
  assert.match(productApp, /allowed_origins/);
});

test("public MCP OAuth registration has abuse controls", () => {
  const register = readFileSync("app/api/mcp/oauth/register/route.ts", "utf8");

  assert.match(register, /MAX_REGISTER_PAYLOAD_BYTES/);
  assert.match(register, /MCP_OAUTH_REGISTRATION_LIMIT_PER_HOUR/);
  assert.match(register, /registrationLimitReached/);
  assert.match(register, /created_at >= now\(\) - interval '1 hour'/);
  assert.match(register, /rate_limited/);
});

test("production worker redrive loops are capped and non-overlapping", () => {
  const worker = readFileSync("scripts/production-worker.ts", "utf8");
  const flyDeploy = readFileSync("scripts/deploy-fly-worker.ts", "utf8");
  const maintenance = readFileSync("core/substrate/workflows/maintenance-trigger.ts", "utf8");
  const maintenanceRoute = readFileSync("app/api/internal/workflows/maintenance/route.ts", "utf8");

  assert.match(worker, /PRODUCT_REDRIVE_SIGNAL_LIMIT/);
  assert.match(worker, /PRODUCT_REDRIVE_REPLY_LIMIT/);
  assert.match(worker, /PRODUCT_REDRIVE_RECOMMENDATION_LIMIT/);
  assert.match(worker, /PRODUCT_EVENT_DISPATCH_LIMIT/);
  assert.match(worker, /NATS_DISPATCH_REDRIVE_LIMIT/);
  assert.match(worker, /WORKER_DATABASE_POOL_MAX/);
  assert.match(worker, /applyWorkerPoolOverride/);
  assert.match(worker, /PRODUCT_EVENT_DISPATCH_LIMIT=0/);
  assert.match(worker, /nonNegativeIntegerEnv/);
  assert.match(worker, /runStartupTask\("product play redrive"/);
  assert.match(worker, /initial \$\{name\} failed; continuing/);
  assert.match(worker, /productRedriveInFlight/);
  assert.match(worker, /pendingDispatchRedriveInFlight/);
  assert.match(readFileSync("core/product/app.ts", "utf8"), /createConcurrencyGate/);
  assert.match(flyDeploy, /CREDENTIALS_ENCRYPTION_KEY/);
  assert.match(flyDeploy, /NATS_DISPATCH_REDRIVE_LIMIT/);
  assert.match(maintenance, /maxWorkspacePolls/);
  assert.match(maintenanceRoute, /MAINTENANCE_WORKSPACE_POLL_LIMIT/);
});
