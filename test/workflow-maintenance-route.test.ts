import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Pool } from "pg";
import {
  dynamic,
  handleMaintenanceRequest,
  hasAnyBearerSecret,
  maxDuration,
  runtime,
} from "../app/api/internal/workflows/maintenance/route.ts";
import type {
  WorkflowRuntime,
  WorkspaceMaintenanceTriggerDeps,
  WorkspaceMaintenanceTriggerSummary,
} from "../core/substrate/workflows/index.ts";

function authorizedRequest(secret: string | null): Request {
  return new Request("https://bombsell.test/api/internal/workflows/maintenance", {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function summary(
  overrides: Partial<WorkspaceMaintenanceTriggerSummary> = {},
): WorkspaceMaintenanceTriggerSummary {
  return {
    triggered_at: "2026-06-16T12:00:00.000Z",
    platform_catalog_polls_started: 0,
    platform_expiry_sweeps_started: 0,
    workspace_polls_started: 0,
    warmup_sweeps_started: 0,
    outlook_repairs_started: 0,
    failures: [],
    ...overrides,
  };
}

test("maintenance route accepts either maintenance or Vercel cron bearer secret", () => {
  assert.equal(
    hasAnyBearerSecret("Bearer maintenance-secret", [
      "maintenance-secret",
      "cron-secret",
    ]),
    true,
  );
  assert.equal(
    hasAnyBearerSecret("Bearer cron-secret", [
      "maintenance-secret",
      "cron-secret",
    ]),
    true,
  );
  assert.equal(
    hasAnyBearerSecret("Bearer wrong-secret", [
      "maintenance-secret",
      "cron-secret",
    ]),
    false,
  );
  assert.equal(
    hasAnyBearerSecret("Basic cron-secret", [
      "maintenance-secret",
      "cron-secret",
    ]),
    false,
  );
  assert.equal(
    hasAnyBearerSecret(null, ["maintenance-secret", "cron-secret"]),
    false,
  );
});

test("maintenance route fails closed without configured secrets", async () => {
  const response = await handleMaintenanceRequest(
    authorizedRequest("cron-secret"),
    {
      allowedSecrets: [],
      ingressUrl: "",
    },
  );

  assert.equal(response.status, 500);
  assert.match(await response.text(), /MAINTENANCE_TRIGGER_SECRET or CRON_SECRET/);
});

test("maintenance route rejects unauthorized scheduler requests", async () => {
  const response = await handleMaintenanceRequest(
    authorizedRequest("wrong-secret"),
    {
      allowedSecrets: ["maintenance-secret", "cron-secret"],
      ingressUrl: "",
    },
  );

  assert.equal(response.status, 401);
});

test("maintenance route requires Restate ingress unless runtime is injected", async () => {
  const response = await handleMaintenanceRequest(
    authorizedRequest("cron-secret"),
    {
      allowedSecrets: ["cron-secret"],
      ingressUrl: "",
    },
  );

  assert.equal(response.status, 500);
  assert.match(await response.text(), /RESTATE_INGRESS_URL/);
});

test("maintenance route wakes durable workflow trigger without doing product work", async () => {
  const pool = {} as Pool;
  const workflowRuntime = {
    async start() {
      throw new Error("route should not start workflows directly");
    },
  } satisfies Pick<WorkflowRuntime, "start">;
  let seenDeps: WorkspaceMaintenanceTriggerDeps | null = null;

  const response = await handleMaintenanceRequest(
    authorizedRequest("cron-secret"),
    {
      allowedSecrets: ["maintenance-secret", "cron-secret"],
      pool,
      runtime: workflowRuntime,
      trigger: async (deps) => {
        seenDeps = deps;
        return summary({ workspace_polls_started: 2 });
      },
    },
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), summary({ workspace_polls_started: 2 }));
  assert.ok(seenDeps);
  assert.equal(seenDeps.pool, pool);
  assert.equal(seenDeps.runtime, workflowRuntime);
});

test("maintenance route reports partial workflow trigger failures", async () => {
  const response = await handleMaintenanceRequest(
    authorizedRequest("cron-secret"),
    {
      allowedSecrets: ["cron-secret"],
      pool: {} as Pool,
      runtime: {
        async start() {
          throw new Error("route should delegate to trigger");
        },
      },
      trigger: async () =>
        summary({
          failures: [
            {
              workflow_name: "email_outlook_subscription_repair",
              workspace_id: "workspace-1",
              error: "Restate unavailable",
            },
          ],
        }),
    },
  );

  assert.equal(response.status, 207);
  assert.equal(
    (await response.json() as WorkspaceMaintenanceTriggerSummary).failures[0]
      .workflow_name,
    "email_outlook_subscription_repair",
  );
});

test("maintenance route reports trigger discovery failures", async () => {
  const response = await handleMaintenanceRequest(
    authorizedRequest("cron-secret"),
    {
      allowedSecrets: ["cron-secret"],
      pool: {} as Pool,
      runtime: {
        async start() {
          throw new Error("route should delegate to trigger");
        },
      },
      trigger: async () => {
        throw new Error("database unavailable");
      },
    },
  );

  assert.equal(response.status, 503);
  assert.match(await response.text(), /database unavailable/);
});

test("maintenance route is configured as a Vercel cron-facing Node function", () => {
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const route = readFileSync(
    "app/api/internal/workflows/maintenance/route.ts",
    "utf8",
  );

  assert.equal(dynamic, "force-dynamic");
  assert.equal(runtime, "nodejs");
  assert.equal(maxDuration, 60);
  assert.deepEqual(vercel.crons, [
    {
      path: "/api/internal/workflows/maintenance",
      schedule: "*/5 * * * *",
    },
  ]);
  assert.match(route, /triggerDueWorkspaceMaintenance/);
  assert.match(route, /createRestateWorkflowRuntime/);
  assert.doesNotMatch(route, /pool\.query\(/);
});
