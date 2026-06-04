#!/usr/bin/env node
/**
 * Operator gate for recurring production blockers.
 *
 * Strict verifiers intentionally fail on recent ECS health events. The
 * optional legacy SES check only runs when AWS_SES_REQUIRED=1 because customer-
 * connected Outlook mailboxes are the launch-critical outbound path.
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
import {
  runOutlookReadinessProbe,
  type OutlookReadinessResult,
} from "./verify-outlook-readiness.ts";

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
      name: "Managed owned-domain email",
      status: "ok",
      detail: skipped.detail ?? "Managed owned-domain provider is not required.",
      next: "No AWS action needed. Verify Outlook/Microsoft Graph send and reply sync for launch outbound.",
    };
  }

  const failed = result.steps.filter((step) => step.status === "fail");
  if (failed.length === 0) {
    return {
      name: "Managed owned-domain email",
      status: "ok",
      detail: "Production access, sending, verified identity, and SNS feedback destination are ready.",
      next: "Owned-domain outbound can use the legacy SES adapter subject to app-side volume gates.",
    };
  }

  const productionAccessFailure = failed.find((step) =>
    step.label === "ses: production access enabled"
  );
  const otherFailures = failed.filter((step) => step !== productionAccessFailure);
  if (productionAccessFailure && otherFailures.length === 0) {
    return {
      name: "Managed owned-domain email",
      status: "external",
      detail: productionAccessFailure.detail ?? "SES production access is not enabled.",
      next: "Do not re-debug app SES/SNS wiring. Leave SES disabled for launch, or replace this optional capacity adapter with a non-AWS provider behind the same channel contract.",
    };
  }

  return {
    name: "Managed owned-domain email",
    status: "fail",
    detail: failed.map((step) =>
      `${step.label}${step.detail ? `: ${step.detail}` : ""}`
    ).join(" | "),
    next: "Fix this intentionally enabled SES adapter, or disable AWS_SES_REQUIRED and use Outlook/non-AWS managed capacity instead.",
  };
}

export function summarizeProductionGate(input: {
  restate: RestateEcsHealthResult;
  outlook: OutlookReadinessResult;
  ses: AwsSesReadinessResult;
}): ProductionGateResult {
  const decisions = [
    classifyRestateEcsGate(input.restate),
    classifyOutlookGate(input.outlook),
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
    outlook: await runOutlookReadinessProbe(),
    ses: shouldRunAwsSesGate(process.env)
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

export function classifyOutlookGate(
  result: OutlookReadinessResult,
): ProductionGateDecision {
  if (result.ok) {
    return {
      name: "Outlook outbound",
      status: "ok",
      detail: `${result.connectedAccounts} connected Outlook account(s), ${result.activeSubscriptions} active reply-sync subscription(s).`,
      next: "Run a controlled durable Play send/reply test before broad customer traffic.",
    };
  }

  const failed = result.steps.filter((step) => step.status === "fail");
  const database = failed.find((step) => step.label === "outlook: database configured");
  if (database) {
    return {
      name: "Outlook outbound",
      status: "external",
      detail: database.detail ?? "Production database was not available for the Outlook readiness probe.",
      next: "Run verify:production-gate with DATABASE_URL loaded, or run npm run verify:outlook from an environment that can read production channel accounts.",
    };
  }

  const connectedMailbox = failed.find((step) => step.label === "outlook: connected mailbox");
  if (connectedMailbox) {
    return {
      name: "Outlook outbound",
      status: "external",
      detail: connectedMailbox.detail ?? "No connected Outlook mailbox is available.",
      next: "Connect a Microsoft 365 mailbox from Profile or Deliverability, then rerun npm run verify:outlook and verify a controlled send/reply sync.",
    };
  }

  return {
    name: "Outlook outbound",
    status: "fail",
    detail: failed.map((step) =>
      `${step.label}${step.detail ? `: ${step.detail}` : ""}`
    ).join(" | "),
    next: "Repair Outlook subscription/account state before sending customer outbound through Microsoft Graph.",
  };
}

function shouldRunAwsSesGate(
  env: Record<string, string | undefined>,
): boolean {
  return env.AWS_SES_REQUIRED?.trim() === "1";
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
        detail: "Not required; customer-connected Outlook mailboxes are the primary outbound path.",
      },
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
