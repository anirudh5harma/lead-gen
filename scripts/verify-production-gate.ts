#!/usr/bin/env node
/**
 * Operator gate for recurring production blockers.
 *
 * Fly is the canonical worker host. Legacy AWS verifiers only run when
 * explicitly enabled because customer-connected Outlook mailboxes and the Fly
 * worker are the launch-critical production path.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  readEventDispatchTransportHealth,
} from "../core/product/health.ts";
import { resolveProductSubstrateMode } from "../core/product/substrate.ts";
import { tryGetPool } from "../core/substrate/storage/index.ts";
import {
  runAwsSesReadinessProbe,
  type AwsSesReadinessResult,
} from "./verify-aws-ses.ts";
import {
  runRestateEcsHealthProbe,
  type RestateEcsHealthResult,
} from "./verify-restate-ecs-health.ts";
import {
  resolveFlyWorkerHostProbeOptions,
  runFlyWorkerHostProbe,
  type FlyWorkerHostProbeResult,
} from "./fly-worker-host.ts";
import {
  runOutlookReadinessProbe,
  type OutlookReadinessResult,
} from "./verify-outlook-readiness.ts";
import {
  runSharedXReadinessProbe,
  type SharedXReadinessResult,
} from "./verify-shared-x-readiness.ts";
import {
  runWorkspaceIsolationProbe,
  type WorkspaceIsolationResult,
} from "./verify-workspace-isolation.ts";

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

export interface EventDispatchGateProbe {
  ok: boolean;
  status: "ok" | "external" | "fail";
  detail: string;
}

export function classifyFlyWorkerHostGate(
  result: FlyWorkerHostProbeResult,
): ProductionGateDecision {
  const failed = result.checks.filter((check) => check.status === "fail");
  if (failed.length === 0) {
    return {
      name: "Fly worker host",
      status: "ok",
      detail: `${result.publicUrl} passed Fly config, machine, and /health checks.`,
      next: "Safe to continue monitoring with npm run verify:fly-cutover.",
    };
  }

  return {
    name: "Fly worker host",
    status: "fail",
    detail: failed.map((check) => `${check.name}: ${check.detail}`).join(" | "),
    next: "Investigate the failing Fly config, machine, or health check before raising production volume.",
  };
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

export function classifyWorkerHostGate(input: {
  fly: FlyWorkerHostProbeResult;
  legacyEcs?: RestateEcsHealthResult | null;
}): ProductionGateDecision {
  const canonical = classifyFlyWorkerHostGate(input.fly);
  const legacy = input.legacyEcs ? classifyRestateEcsGate(input.legacyEcs) : null;
  if (!legacy || legacy.status === "ok") return canonical;
  if (canonical.status === "fail") return canonical;
  return {
    name: canonical.name,
    status: legacy.status,
    detail: `${canonical.detail} Legacy AWS/ECS verifier: ${legacy.detail}`,
    next: legacy.next,
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
  workerHost: FlyWorkerHostProbeResult;
  legacyEcs?: RestateEcsHealthResult | null;
  outlook: OutlookReadinessResult;
  ses: AwsSesReadinessResult;
  sharedX: SharedXReadinessResult;
  workspaceIsolation: WorkspaceIsolationResult;
  eventDispatch: EventDispatchGateProbe;
}): ProductionGateResult {
  const decisions = [
    classifyWorkerHostGate({
      fly: input.workerHost,
      legacyEcs: input.legacyEcs,
    }),
    classifyEventDispatchGate(input.eventDispatch),
    classifyOutlookGate(input.outlook),
    classifySharedXGate(input.sharedX),
    classifyAwsSesGate(input.ses),
    classifyWorkspaceIsolationGate(input.workspaceIsolation),
  ];
  return {
    ok: decisions.every((decision) => decision.status !== "fail"),
    launchReady: decisions.every((decision) => decision.status === "ok"),
    decisions,
  };
}

async function main(): Promise<void> {
  loadDotenvLocal();
  const result = summarizeProductionGate({
    workerHost: await runFlyWorkerHostProbe(resolveFlyWorkerHostProbeOptions(process.env)),
    legacyEcs: shouldRunAwsEcsLegacyGate(process.env)
      ? await runRestateEcsHealthProbe()
      : null,
    eventDispatch: await runEventDispatchGateProbe(),
    outlook: await runOutlookReadinessProbe(),
    sharedX: await runSharedXReadinessProbe(),
    ses: shouldRunAwsSesGate(process.env)
      ? await runAwsSesReadinessProbe()
      : skippedAwsSesReadiness(),
    workspaceIsolation: await runWorkspaceIsolationProbe(),
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

export function classifyEventDispatchGate(
  result: EventDispatchGateProbe,
): ProductionGateDecision {
  if (result.status === "external") {
    return {
      name: "Event dispatch transport",
      status: "external",
      detail: result.detail,
      next: "Run verify:production-gate with DATABASE_URL loaded, or inspect product Health from an environment that can query production event dispatch rows.",
    };
  }

  if (result.ok) {
    return {
      name: "Event dispatch transport",
      status: "ok",
      detail: result.detail,
      next: "Keep monitoring product Health for dead-lettered or repeatedly flapping NATS dispatch rows.",
    };
  }

  return {
    name: "Event dispatch transport",
    status: "fail",
    detail: result.detail,
    next: "Restart or redeploy the worker, then confirm event_nats_dispatches no longer accumulate transient CONNECTION_CLOSED/TIMEOUT failures.",
  };
}

export function classifyWorkspaceIsolationGate(
  result: WorkspaceIsolationResult,
): ProductionGateDecision {
  const database = result.steps.find((step) =>
    step.label === "workspace isolation: database configured" && step.status === "fail"
  );
  if (database) {
    return {
      name: "Workspace isolation",
      status: "external",
      detail: database.detail ?? "Production database was not available for the workspace isolation probe.",
      next: "Run verify:production-gate with DATABASE_URL loaded, or run npm run verify:workspace-isolation from an environment that can inspect production auth/workspace state.",
    };
  }

  if (result.ok) {
    return {
      name: "Workspace isolation",
      status: "ok",
      detail: "Confirmed users are isolated off the legacy shared default workspace.",
      next: "Safe to keep monitoring the tenancy audit with npm run verify:workspace-isolation.",
    };
  }

  const failed = result.steps.filter((step) => step.status === "fail");
  return {
    name: "Workspace isolation",
    status: "fail",
    detail: failed.map((step) =>
      `${step.label}${step.detail ? `: ${step.detail}` : ""}`
    ).join(" | "),
    next: "Migrate legacy users off the shared default workspace before treating production tenancy as go-live ready.",
  };
}

export function classifySharedXGate(
  result: SharedXReadinessResult,
): ProductionGateDecision {
  if (result.ok) {
    const keyHint =
      result.provider === "twitterapi_io"
        ? "TWITTERAPI_IO_API_KEY"
        : result.provider === "socialdata"
          ? "SOCIALDATA_API_KEY"
          : "X_API_BEARER_TOKEN";
    return {
      name: "Shared X ingestion",
      status: "ok",
      detail: `${result.provider} configured with ${result.enabledRuleCount} pooled rule(s) at projected $${(result.projectedMonthlyCostUsd ?? 0).toFixed(2)}/mo against cap $${(result.monthlyBudgetUsd ?? 0).toFixed(2)}/mo.`,
      next: `Keep ${keyHint} in the worker/app runtime and trigger a controlled ingest_shared_x_poll smoke run whenever provider credentials rotate.`,
    };
  }

  const failed = result.steps.filter((step) => step.status === "fail");
  const database = failed.find((step) => step.label === "shared-x: database configured");
  if (database) {
    return {
      name: "Shared X ingestion",
      status: "external",
      detail: database.detail ?? "Production database was not available for the pooled X readiness probe.",
      next: "Run npm run verify:shared-x-readiness from an environment that can read platform_signal_sources.",
    };
  }

  const missingSetup = failed.find((step) =>
    step.label === "shared-x: source configured" ||
    step.label === "shared-x: provider key present"
  );
  if (missingSetup) {
    return {
      name: "Shared X ingestion",
      status: "external",
      detail: missingSetup.detail ?? "Shared X source setup is incomplete.",
      next: missingSetup.label === "shared-x: provider key present"
        ? "Add the required X provider key to the runtime, then rerun npm run verify:shared-x-readiness."
        : "Create or enable the x_search_shared platform source, then rerun npm run verify:shared-x-readiness.",
    };
  }

  return {
    name: "Shared X ingestion",
    status: "fail",
    detail: failed.map((step) =>
      `${step.label}${step.detail ? `: ${step.detail}` : ""}`
    ).join(" | "),
    next: "Fix the shared X provider or budget configuration before depending on pooled X signals.",
  };
}

function shouldRunAwsSesGate(
  env: Record<string, string | undefined>,
): boolean {
  return env.AWS_SES_REQUIRED?.trim() === "1";
}

function shouldRunAwsEcsLegacyGate(
  env: Record<string, string | undefined>,
): boolean {
  return env.AWS_ECS_LEGACY?.trim() === "1";
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

async function runEventDispatchGateProbe(): Promise<EventDispatchGateProbe> {
  const pool = tryGetPool();
  if (!pool) {
    return {
      ok: false,
      status: "external",
      detail: "Production database was not available for the event dispatch transport probe.",
    };
  }

  const substrate = resolveProductSubstrateMode(process.env.BOMBSELL_SUBSTRATE, process.env);
  const health = await readEventDispatchTransportHealth(pool, substrate);
  if (health.status === "ok") {
    return {
      ok: true,
      status: "ok",
      detail: health.detail,
    };
  }

  return {
    ok: false,
    status: "fail",
    detail: health.detail,
  };
}

function loadDotenvLocal(): void {
  const path = ".env.local";
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] == null) process.env[key] = value;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
