#!/usr/bin/env node
/**
 * Operator gate for recurring production blockers.
 *
 * Strict verifiers intentionally fail on recent ECS health events and SES
 * sandbox state. This gate classifies those known states so operators can see
 * whether there is a current engineering failure, a wait window, or an
 * external AWS review blocker.
 */

import { pathToFileURL } from "node:url";
import {
  runAwsSesReadinessProbe,
  type AwsSesReadinessResult,
} from "./verify-aws-ses.ts";
import {
  runRestateEcsHealthProbe,
  type RestateEcsHealthResult,
} from "./verify-restate-ecs-health.ts";

export type ProductionGateStatus = "ok" | "wait" | "external" | "fail";

export interface ProductionGateDecision {
  name: string;
  status: ProductionGateStatus;
  detail: string;
  next: string;
}

export interface ProductionGateResult {
  ok: boolean;
  launchReady: boolean;
  decisions: ProductionGateDecision[];
}

export function classifyRestateEcsGate(
  result: RestateEcsHealthResult,
): ProductionGateDecision {
  const failed = result.checks.filter((check) => check.status === "fail");
  if (failed.length === 0) {
    return {
      name: "Restate ECS",
      status: "ok",
      detail: "Current ECS service, deployment, target health, and Restate logs are clean.",
      next: "Safe to continue monitoring with npm run verify:restate-ecs-health.",
    };
  }

  const onlyRecentEvents = failed.every((check) => check.name === "ecs.service.events");
  const currentStateFailure = result.checks.some((check) =>
    check.status === "fail" && check.name !== "ecs.service.events"
  );
  if (onlyRecentEvents && !currentStateFailure) {
    const detail = failed.map((check) => check.detail).join(" | ");
    return {
      name: "Restate ECS",
      status: "wait",
      detail: `Current service is healthy, but recent ECS replacement events remain in the configured lookback: ${detail}`,
      next: "Do not re-debug ECS. Wait for the lookback window to clear, or run RESTATE_ECS_LOG_LOOKBACK_MINUTES=3 npm run verify:restate-ecs-health for current-state smoke.",
    };
  }

  return {
    name: "Restate ECS",
    status: "fail",
    detail: failed.map((check) => `${check.name}: ${check.detail}`).join(" | "),
    next: "Investigate the failing current-state ECS/ALB/log check before raising ingestion volume.",
  };
}

export function classifyAwsSesGate(
  result: AwsSesReadinessResult,
): ProductionGateDecision {
  const skipped = result.steps.find((step) =>
    step.label === "ses: optional managed owned-domain provider"
  );
  if (skipped) {
    return {
      name: "AWS SES",
      status: "ok",
      detail: skipped.detail ?? "SES managed owned-domain provider is not configured.",
      next: "No AWS action needed for customer-connected Outlook outbound. Run verify:aws-ses only when enabling the optional SES managed-domain path.",
    };
  }

  const failed = result.steps.filter((step) => step.status === "fail");
  if (failed.length === 0) {
    return {
      name: "AWS SES",
      status: "ok",
      detail: "Production access, sending, verified identity, and SNS feedback destination are ready.",
      next: "Owned-domain outbound can use SES subject to app-side volume gates.",
    };
  }

  const productionAccessFailure = failed.find((step) =>
    step.label === "ses: production access enabled"
  );
  const otherFailures = failed.filter((step) => step !== productionAccessFailure);
  if (productionAccessFailure && otherFailures.length === 0) {
    return {
      name: "AWS SES",
      status: "external",
      detail: productionAccessFailure.detail ?? "SES production access is not enabled.",
      next: "Do not re-debug app SES/SNS wiring. The remaining action is AWS account production-access approval or appeal.",
    };
  }

  return {
    name: "AWS SES",
    status: "fail",
    detail: failed.map((step) =>
      `${step.label}${step.detail ? `: ${step.detail}` : ""}`
    ).join(" | "),
    next: "Fix the app/provider SES wiring before requesting broad owned-domain sends.",
  };
}

export function summarizeProductionGate(input: {
  restate: RestateEcsHealthResult;
  ses: AwsSesReadinessResult;
}): ProductionGateResult {
  const decisions = [
    classifyRestateEcsGate(input.restate),
    classifyAwsSesGate(input.ses),
  ];
  return {
    ok: decisions.every((decision) => decision.status !== "fail"),
    launchReady: decisions.every((decision) => decision.status === "ok"),
    decisions,
  };
}

async function main(): Promise<void> {
  const result = summarizeProductionGate({
    restate: await runRestateEcsHealthProbe(),
    ses: isSesManagedOutboundConfigured(process.env)
      ? await runAwsSesReadinessProbe()
      : skippedAwsSesReadiness(),
  });

  console.log("Production gate");
  for (const decision of result.decisions) {
    const label = decision.status.toUpperCase().padEnd(8, " ");
    console.log(`  ${label} ${decision.name} - ${decision.detail}`);
    console.log(`           next: ${decision.next}`);
  }

  if (result.launchReady) {
    console.log("\nProduction gate is launch-ready.");
    return;
  }

  if (result.ok) {
    console.log("\nProduction gate has known non-engineering blockers, but no current unknown infrastructure failure.");
    if (process.env.PRODUCTION_GATE_STRICT === "1") process.exit(1);
    return;
  }

  console.error("\nProduction gate found an unexpected current failure.");
  process.exit(1);
}

function isSesManagedOutboundConfigured(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(
    env.AWS_SNS_TOPIC_ARNS?.trim() ||
      env.SES_SENDING_DOMAIN?.trim() ||
      env.AWS_SES_REQUIRED?.trim() === "1",
  );
}

function skippedAwsSesReadiness(): AwsSesReadinessResult {
  return {
    ok: true,
    region: process.env.AWS_REGION?.trim() || "us-east-1",
    configurationSet: process.env.SES_CONFIGURATION_SET?.trim() || "bombsell-outbound",
    steps: [
      {
        label: "ses: optional managed owned-domain provider",
        status: "ok",
        detail: "Not configured; customer-connected Outlook mailboxes are the primary outbound path.",
      },
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
