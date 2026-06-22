import assert from "node:assert/strict";
import { test } from "node:test";
import {
  flyWorkerIssues,
  normalizeOrigin,
  parseFlyAppName,
  requiredWorkflowDeploymentUriIssues,
  summarizeFlyMachine,
} from "../scripts/verify-fly-cutover.ts";
import { summarizeRestateDeployments } from "../core/product/health.ts";

test("fly cutover parses app name from fly.toml", () => {
  assert.equal(parseFlyAppName('app = "bombsell-production-worker"\n'), "bombsell-production-worker");
  assert.equal(parseFlyAppName("primary_region = \"iad\"\n"), null);
});

test("fly cutover accepts the intended Fly worker shape", () => {
  const machine = summarizeFlyMachine({
    id: "9080",
    name: "bombsell-production-worker",
    state: "started",
    region: "iad",
    config: {
      env: {
        APP_ORIGIN: "https://www.bombsell.com",
        MANAGED_OWNED_DOMAIN_EMAIL_ENABLED: "0",
        RESTATE_WORKFLOW_HTTP1: "1",
        RESTATE_WORKFLOW_PORT: "8080",
        WORKER_COMMAND: "worker:production",
      },
      guest: {
        cpu_kind: "shared",
        cpus: 2,
        memory_mb: 1024,
      },
      restart: {
        policy: "on-failure",
        max_retries: 10,
      },
      services: [
        {
          internal_port: 8080,
          autostart: true,
          autostop: "off",
          min_machines_running: 1,
        },
      ],
    },
  });

  assert.ok(machine);
  assert.deepEqual(
    flyWorkerIssues(machine, {
      expectedCpuKind: "shared",
      expectedCpus: 2,
      expectedMemoryMb: 1024,
      expectedInternalPort: 8080,
      expectedAppOrigin: "https://www.bombsell.com",
    }),
    [],
  );
});

test("fly cutover rejects wrong compute and autostop settings", () => {
  const machine = summarizeFlyMachine({
    id: "bad-machine",
    state: "started",
    config: {
      env: {
        APP_ORIGIN: "https://wrong.example.com",
        MANAGED_OWNED_DOMAIN_EMAIL_ENABLED: "1",
        RESTATE_WORKFLOW_HTTP1: "0",
        RESTATE_WORKFLOW_PORT: "9090",
        WORKER_COMMAND: "worker:managed",
      },
      guest: {
        cpu_kind: "performance",
        cpus: 1,
        memory_mb: 512,
      },
      restart: {
        policy: "always",
        max_retries: 3,
      },
      services: [
        {
          internal_port: 9090,
          autostart: false,
          autostop: "stop",
          min_machines_running: 0,
        },
      ],
    },
  });

  assert.ok(machine);
  assert.deepEqual(
    flyWorkerIssues(machine, {
      expectedCpuKind: "shared",
      expectedCpus: 2,
      expectedMemoryMb: 1024,
      expectedInternalPort: 8080,
      expectedAppOrigin: "https://www.bombsell.com",
    }),
    [
      "cpu kind is performance, expected shared",
      "cpu count is 1, expected 2",
      "memory is 512 MB, expected 1024 MB",
      "internal port is 9090, expected 8080",
      "autostart must be true",
      "autostop is stop, expected off",
      "min_machines_running is 0, expected 1",
      "restart policy is always, expected on-failure",
      "restart retries are 3, expected 10",
      "WORKER_COMMAND is worker:managed, expected worker:production",
      "RESTATE_WORKFLOW_HTTP1 is 0, expected 1",
      "RESTATE_WORKFLOW_PORT is 9090, expected 8080",
      "APP_ORIGIN is https://wrong.example.com, expected https://www.bombsell.com",
      "MANAGED_OWNED_DOMAIN_EMAIL_ENABLED is 1, expected 0",
    ],
  );
});

test("fly cutover requires workflow deployments to point at Fly", () => {
  const requiredServices = [
    "series_a_cold_open",
    "play.signal_to_email.v1",
  ];
  const flySummary = summarizeRestateDeployments({
    deployments: [
      {
        id: "dp_fly",
        uri: "https://bombsell-production-worker.fly.dev/",
        services: requiredServices.map((name) => ({ name })),
      },
    ],
  }, requiredServices);
  assert.deepEqual(
    requiredWorkflowDeploymentUriIssues(
      flySummary,
      "https://bombsell-production-worker.fly.dev",
      requiredServices,
    ),
    [],
  );

  const ecsSummary = summarizeRestateDeployments({
    deployments: [
      {
        id: "dp_ecs",
        uri: "https://bo-ecs.example.aws/",
        services: requiredServices.map((name) => ({ name })),
      },
    ],
  }, requiredServices);
  assert.deepEqual(
    requiredWorkflowDeploymentUriIssues(
      ecsSummary,
      "https://bombsell-production-worker.fly.dev",
      requiredServices,
    ),
    [
      "dp_ecs@https://bo-ecs.example.aws/ still points outside https://bombsell-production-worker.fly.dev",
    ],
  );
});

test("fly cutover normalizes URL origins", () => {
  assert.equal(
    normalizeOrigin("https://Bombsell-Production-Worker.fly.dev/health"),
    "https://bombsell-production-worker.fly.dev",
  );
  assert.equal(normalizeOrigin("not a url"), null);
});
