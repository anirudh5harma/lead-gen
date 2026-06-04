import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyAwsSesGate,
  classifyRestateEcsGate,
  summarizeProductionGate,
} from "../scripts/verify-production-gate.ts";
import type { AwsSesReadinessResult } from "../scripts/verify-aws-ses.ts";
import type { RestateEcsHealthResult } from "../scripts/verify-restate-ecs-health.ts";

function healthyRestate(): RestateEcsHealthResult {
  return {
    ok: true,
    region: "us-east-1",
    cluster: "bombsell-workers",
    service: "bombsell-restate-workflows",
    checks: [
      { name: "ecs.service.status", status: "ok", detail: "ACTIVE" },
      { name: "ecs.service.steady", status: "ok", detail: "desired=1 running=1 pending=0" },
      { name: "ecs.deployment.rollout", status: "ok", detail: "primary=COMPLETED desired=1 running=1" },
      { name: "ecs.service.events", status: "ok", detail: "no target-health or replacement events" },
      { name: "elb.target_health", status: "ok", detail: "healthy=1/1 states=healthy" },
      { name: "logs.restate_errors", status: "ok", detail: "no Restate stream/health errors" },
    ],
  };
}

function healthySes(): AwsSesReadinessResult {
  return {
    ok: true,
    region: "us-east-1",
    configurationSet: "bombsell-outbound",
    steps: [
      { label: "ses: production access enabled", status: "ok" },
      { label: "ses: sending enabled", status: "ok" },
      { label: "ses: at least one verified sending identity", status: "ok", detail: "go.bombsell.com" },
      { label: "ses: config set publishes delivery/bounce/complaint to trusted SNS", status: "ok" },
    ],
  };
}

test("production gate classifies stale ECS replacement history as wait", () => {
  const restate = healthyRestate();
  restate.ok = false;
  restate.checks = restate.checks.map((check) =>
    check.name === "ecs.service.events"
      ? {
          ...check,
          status: "fail",
          detail: "1 recent troubling service event: task was unhealthy",
        }
      : check,
  );

  const decision = classifyRestateEcsGate(restate);

  assert.equal(decision.status, "wait");
  assert.match(decision.next, /Do not re-debug ECS/);
});

test("production gate classifies current ECS target failure as fail", () => {
  const restate = healthyRestate();
  restate.ok = false;
  restate.checks = restate.checks.map((check) =>
    check.name === "elb.target_health"
      ? {
          ...check,
          status: "fail",
          detail: "healthy=0/1 states=unhealthy",
        }
      : check,
  );

  assert.equal(classifyRestateEcsGate(restate).status, "fail");
});

test("production gate classifies SES sandbox review as external", () => {
  const ses = healthySes();
  ses.ok = false;
  ses.steps = ses.steps.map((step) =>
    step.label === "ses: production access enabled"
      ? {
          ...step,
          status: "fail",
          detail: "SES account is still in sandbox; review=DENIED; case=177998710600026",
        }
      : step,
  );

  const decision = classifyAwsSesGate(ses);

  assert.equal(decision.status, "external");
  assert.match(decision.next, /Do not re-debug app SES\/SNS wiring/);
});

test("production gate classifies broken SES feedback wiring as fail", () => {
  const ses = healthySes();
  ses.ok = false;
  ses.steps = ses.steps.map((step) =>
    step.label === "ses: config set publishes delivery/bounce/complaint to trusted SNS"
      ? {
          ...step,
          status: "fail",
          detail: "missing SNS destination",
        }
      : step,
  );

  assert.equal(classifyAwsSesGate(ses).status, "fail");
});

test("production gate treats unconfigured SES as optional managed capacity", () => {
  const ses: AwsSesReadinessResult = {
    ok: true,
    region: "us-east-1",
    configurationSet: "bombsell-outbound",
    steps: [
      {
        label: "ses: optional managed owned-domain provider",
        status: "ok",
        detail: "Not configured; customer-connected Outlook mailboxes are the primary outbound path.",
      },
    ],
  };

  const decision = classifyAwsSesGate(ses);

  assert.equal(decision.status, "ok");
  assert.match(decision.next, /customer-connected Outlook outbound/);
});

test("production gate is operator-ok but not launch-ready for known blockers", () => {
  const restate = healthyRestate();
  restate.ok = false;
  restate.checks = restate.checks.map((check) =>
    check.name === "ecs.service.events"
      ? { ...check, status: "fail", detail: "recent replacement event" }
      : check,
  );
  const ses = healthySes();
  ses.ok = false;
  ses.steps = ses.steps.map((step) =>
    step.label === "ses: production access enabled"
      ? { ...step, status: "fail", detail: "SES account is still in sandbox" }
      : step,
  );

  const result = summarizeProductionGate({ restate, ses });

  assert.equal(result.ok, true);
  assert.equal(result.launchReady, false);
  assert.deepEqual(
    result.decisions.map((decision) => decision.status),
    ["wait", "external"],
  );
});
