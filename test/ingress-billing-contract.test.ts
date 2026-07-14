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
  assert.match(checkout, /captureWorkspaceOwnerEmail/);
  assert.doesNotMatch(checkout, /update workspaces/);
});

test("Settings ICP mutation uses typed product event path", () => {
  const action = readFileSync("app/dashboard/settings/actions.ts", "utf8");
  const product = readFileSync("core/product/app.ts", "utf8");

  assert.match(action, /updateIcpText/);
  assert.doesNotMatch(action, /update workspace_icps/);
  assert.match(product, /workspace\.icp\.text_updated/);
  assert.match(product, /previous_updated_at: existing\.updated_at\.toISOString\(\)/);
  assert.match(product, /name === existing\.name/);
  const tools = readFileSync("core/product/tools.ts", "utf8");
  const assistant = readFileSync("core/product/assistant/tool-surface.ts", "utf8");
  assert.match(tools, /name: "product\.icp\.update"/);
  assert.match(assistant, /productTool: "product\.icp\.update"/);
});

test("Settings exposes upgrade and subscription management without redirecting", () => {
  const settings = readFileSync("app/dashboard/settings/page.tsx", "utf8");
  const planSection = readFileSync("components/dashboard/PlanSection.tsx", "utf8");
  const nextConfig = readFileSync("next.config.ts", "utf8");

  assert.match(settings, /<PlanSection billing=\{billing\} \/>/);
  assert.match(planSection, /label="Upgrade to Pro"/);
  assert.match(planSection, /label="Manage \/ cancel subscription"/);
  assert.doesNotMatch(nextConfig, /source: "\/dashboard\/settings"/);
});

test("billing portal falls back to Dodo login for a known subscription", () => {
  const portal = readFileSync("app/api/billing/portal/route.ts", "utf8");

  assert.match(portal, /subscription_external_id/);
  assert.match(portal, /if \(!customerId && !subscriptionId\)/);
  assert.match(portal, /getPortalUrl\(\{\s*customerId,/);
  assert.match(portal, /new URL\("\/dashboard\/settings", url\)/);
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
  const journaledNats = readFileSync(
    "core/substrate/events/adapters/journaled-nats.ts",
    "utf8",
  );
  const maintenanceRoute = readFileSync("app/api/internal/workflows/maintenance/route.ts", "utf8");

  assert.match(worker, /PRODUCT_REDRIVE_SIGNAL_LIMIT/);
  assert.match(worker, /PRODUCT_REDRIVE_REPLY_LIMIT/);
  assert.match(worker, /PRODUCT_REDRIVE_RECOMMENDATION_LIMIT/);
  assert.match(worker, /PRODUCT_EVENT_DISPATCH_LIMIT/);
  assert.match(worker, /PRODUCT_SIGNAL_MATCHING_DISPATCH_INTERVAL_MS/);
  assert.match(worker, /dispatchSignalMatchingWorkflowThrottled/);
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
  assert.match(flyDeploy, /PRODUCT_SIGNAL_MATCHING_DISPATCH_INTERVAL_MS/);
  assert.match(maintenance, /maxWorkspacePolls/);
  assert.match(maintenance, /startConcurrency/);
  assert.match(journaledNats, /for update skip locked/);
  assert.match(journaledNats, /const REDRIVE_CONCURRENCY = 4/);
  assert.match(journaledNats, /\[claimLimit, DISPATCH_LEASE_MS\]/);
  assert.match(journaledNats, /DISPATCH_LEASE_MS/);
  assert.match(maintenanceRoute, /MAINTENANCE_WORKSPACE_POLL_LIMIT/);
  assert.match(maintenanceRoute, /MAINTENANCE_TARGET_LIMIT/);
  assert.match(maintenanceRoute, /MAINTENANCE_START_CONCURRENCY/);
});

test("approval decisions are event-first and use one canonical event", () => {
  const product = readFileSync("core/product/app.ts", "utf8");
  const approvals = readFileSync(
    "core/substrate/workflows/approvals.ts",
    "utf8",
  );
  const postgres = readFileSync(
    "core/substrate/workflows/adapters/postgres.ts",
    "utf8",
  );

  assert.doesNotMatch(product, /resolveApproval\(approval_id/);
  assert.match(approvals, /workflow-approval-runtime-resolver-v1/);
  assert.match(approvals, /runtime\.resolveApproval/);
  assert.match(postgres, /note: \(event\.payload as \{ note\?: string \| null \}\)\.note/);
  assert.match(
    product,
    /idempotency_key: `approval\.decided:\$\{input\.approval_id\}`/,
  );
  assert.match(
    postgres,
    /idempotency_key: `approval\.decided:\$\{approval_id\}`/,
  );
  assert.doesNotMatch(
    product,
    /approval\.decided:\$\{input\.approval_id\}:\$\{input\.decision\}/,
  );
});
