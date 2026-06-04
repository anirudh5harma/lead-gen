import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessRestateEcsHealth,
  runRestateEcsHealthProbe,
} from "../scripts/verify-restate-ecs-health.ts";

const now = Date.parse("2026-06-04T12:00:00.000Z");

function healthyService() {
  return {
    serviceName: "bombsell-restate-workflows",
    status: "ACTIVE",
    desiredCount: 1,
    runningCount: 1,
    pendingCount: 0,
    taskDefinition: "bombsell-workers-bombsell-restate-workflows:28",
    loadBalancers: [{ targetGroupArn: "arn:aws:elasticloadbalancing:tg/restate" }],
    deployments: [
      {
        status: "PRIMARY",
        rolloutState: "COMPLETED",
        desiredCount: 1,
        runningCount: 1,
        pendingCount: 0,
      },
    ],
    events: [
      {
        createdAt: "2026-06-04T11:30:00.000Z",
        message: "service reached a steady state.",
      },
    ],
  };
}

function healthyTargets() {
  return {
    TargetHealthDescriptions: [
      {
        Target: { Id: "10.0.0.10", Port: 9080 },
        TargetHealth: { State: "healthy" },
      },
    ],
  };
}

function ecsExpressService() {
  return {
    ...healthyService(),
    taskDefinition: undefined,
    loadBalancers: undefined,
    deployments: [
      {
        status: "PRIMARY",
        taskDefinition: "arn:aws:ecs:us-east-1:767828728931:task-definition/bombsell-workers-bombsell-restate-workflows:28",
        rolloutState: "COMPLETED",
        desiredCount: 1,
        runningCount: 1,
        pendingCount: 0,
      },
    ],
    events: [
      {
        createdAt: "2026-06-04T11:30:00.000Z",
        message: "(service bombsell-restate-workflows) registered 1 targets in (target-group arn:aws:elasticloadbalancing:us-east-1:767828728931:targetgroup/ecs-gateway-tg-449d1a4537a65b91d/5497a31e262dbba1)",
      },
    ],
  };
}

test("Restate ECS health passes when service, target, and logs are quiet", () => {
  const checks = assessRestateEcsHealth({
    service: healthyService(),
    targetHealth: healthyTargets(),
    logGroup: "/aws/ecs/bombsell-restate-workflows",
    logEvents: { events: [{ message: "Restate endpoint listening on 9080" }] },
    now: () => now,
  });

  assert.deepEqual(
    checks.filter((check) => check.status === "fail"),
    [],
  );
  assert.equal(
    checks.find((check) => check.name === "ecs.service.steady")?.detail,
    "desired=1 running=1 pending=0",
  );
});

test("Restate ECS health fails when no target is healthy", () => {
  const checks = assessRestateEcsHealth({
    service: healthyService(),
    targetHealth: {
      TargetHealthDescriptions: [
        {
          Target: { Id: "10.0.0.10", Port: 9080 },
          TargetHealth: {
            State: "unhealthy",
            Reason: "Target.Timeout",
            Description: "Health checks failed",
          },
        },
      ],
    },
    logEvents: { events: [] },
    now: () => now,
  });

  assert.equal(
    checks.find((check) => check.name === "elb.target_health")?.status,
    "fail",
  );
});

test("Restate ECS health fails on recent service or stream errors", () => {
  const checks = assessRestateEcsHealth({
    service: {
      ...healthyService(),
      events: [
        {
          createdAt: "2026-06-04T11:59:00.000Z",
          message: "service task failed ELB health checks and was marked unhealthy",
        },
      ],
    },
    targetHealth: healthyTargets(),
    logEvents: {
      events: [
        {
          timestamp: now - 30_000,
          message: "WARN: Error when processing ingress stream: Connection closed",
        },
      ],
    },
    now: () => now,
  });

  assert.equal(
    checks.find((check) => check.name === "ecs.service.events")?.status,
    "fail",
  );
  assert.equal(
    checks.find((check) => check.name === "logs.restate_errors")?.status,
    "fail",
  );
});

test("Restate ECS probe discovers target group and log group from AWS responses", async () => {
  const calls: string[][] = [];
  const result = await runRestateEcsHealthProbe({
    env: {
      AWS_REGION: "us-east-1",
      RESTATE_ECS_CLUSTER: "cluster",
      RESTATE_ECS_SERVICE: "service",
      RESTATE_ECS_LOG_LOOKBACK_MINUTES: "30",
    },
    now: () => now,
    awsJson: async (args) => {
      calls.push(args);
      const command = args.slice(0, 2).join(" ");
      if (command === "ecs describe-services") {
        return { services: [healthyService()] };
      }
      if (command === "ecs describe-task-definition") {
        return {
          taskDefinition: {
            containerDefinitions: [
              {
                name: "worker",
                logConfiguration: {
                  options: { "awslogs-group": "/aws/ecs/restate" },
                },
              },
            ],
          },
        };
      }
      if (command === "elbv2 describe-target-health") {
        return healthyTargets();
      }
      if (command === "logs filter-log-events") {
        return { events: [] };
      }
      throw new Error(`unexpected aws command: ${args.join(" ")}`);
    },
  });

  assert.equal(result.ok, true);
  assert.ok(
    calls.some((args) => args.includes("--target-group-arn") && args.includes("arn:aws:elasticloadbalancing:tg/restate")),
  );
  assert.ok(
    calls.some((args) => args.includes("--log-group-name") && args.includes("/aws/ecs/restate")),
  );
});

test("Restate ECS probe supports ECS Express service shape", async () => {
  const calls: string[][] = [];
  const result = await runRestateEcsHealthProbe({
    env: {
      AWS_REGION: "us-east-1",
      RESTATE_ECS_CLUSTER: "cluster",
      RESTATE_ECS_SERVICE: "service",
    },
    now: () => now,
    awsJson: async (args) => {
      calls.push(args);
      const command = args.slice(0, 2).join(" ");
      if (command === "ecs describe-services") {
        return { services: [ecsExpressService()] };
      }
      if (command === "ecs describe-task-definition") {
        return {
          taskDefinition: {
            containerDefinitions: [
              {
                name: "Main",
                logConfiguration: {
                  options: { "awslogs-group": "/ecs/bombsell/restate-workflows" },
                },
              },
            ],
          },
        };
      }
      if (command === "elbv2 describe-target-health") {
        return healthyTargets();
      }
      if (command === "logs filter-log-events") {
        return { events: [] };
      }
      throw new Error(`unexpected aws command: ${args.join(" ")}`);
    },
  });

  assert.equal(result.ok, true);
  assert.ok(
    calls.some((args) => args.some((arg) => arg.includes("bombsell-workers-bombsell-restate-workflows:28"))),
  );
  assert.ok(
    calls.some((args) => args.includes("--target-group-arn") && args.includes("arn:aws:elasticloadbalancing:us-east-1:767828728931:targetgroup/ecs-gateway-tg-449d1a4537a65b91d/5497a31e262dbba1")),
  );
});
