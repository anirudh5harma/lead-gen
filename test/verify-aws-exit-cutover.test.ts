import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findRenderWorker,
  normalizeOrigin,
  renderWorkerIssues,
  requiredWorkflowDeploymentUriIssues,
} from "../scripts/verify-aws-exit-cutover.ts";
import { summarizeRestateDeployments } from "../core/product/health.ts";

test("aws exit cutover accepts the intended Render worker shape", () => {
  const worker = findRenderWorker([
    {
      service: {
        id: "srv-worker",
        name: "bombsell-production-worker",
        type: "web_service",
        suspended: "not_suspended",
        dashboardUrl: "https://dashboard.render.com/web/srv-worker",
        serviceDetails: {
          plan: "standard",
          runtime: "docker",
          numInstances: 1,
          healthCheckPath: "/health",
          url: "https://bombsell-production-worker.onrender.com",
        },
      },
    },
  ], "bombsell-production-worker");

  assert.ok(worker);
  assert.deepEqual(renderWorkerIssues(worker, { expectedPlan: "standard" }), []);
});

test("aws exit cutover rejects free sleeping Render services", () => {
  const worker = findRenderWorker([
    {
      service: {
        name: "bombsell-production-worker",
        type: "web_service",
        suspended: "not_suspended",
        serviceDetails: {
          plan: "free",
          runtime: "docker",
          numInstances: 1,
          healthCheckPath: "/health",
          url: "https://bombsell-production-worker.onrender.com",
        },
      },
    },
  ], "bombsell-production-worker");

  assert.ok(worker);
  assert.deepEqual(renderWorkerIssues(worker, { expectedPlan: "standard" }), [
    "plan is free, expected standard",
    "free Render services sleep and are not valid for this always-on worker",
  ]);
});

test("aws exit cutover requires workflow deployments to point at Render", () => {
  const requiredServices = [
    "series_a_cold_open",
    "play.signal_to_email.v1",
  ];
  const renderSummary = summarizeRestateDeployments({
    deployments: [
      {
        id: "dp_render",
        uri: "https://bombsell-production-worker.onrender.com/",
        services: requiredServices.map((name) => ({ name })),
      },
    ],
  }, requiredServices);
  assert.deepEqual(
    requiredWorkflowDeploymentUriIssues(
      renderSummary,
      "https://bombsell-production-worker.onrender.com",
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
      "https://bombsell-production-worker.onrender.com",
      requiredServices,
    ),
    [
      "dp_ecs@https://bo-ecs.example.aws/ still points outside https://bombsell-production-worker.onrender.com",
    ],
  );
});

test("aws exit cutover normalizes URL origins", () => {
  assert.equal(
    normalizeOrigin("https://Bombsell-Production-Worker.onrender.com/health"),
    "https://bombsell-production-worker.onrender.com",
  );
  assert.equal(normalizeOrigin("not a url"), null);
});
