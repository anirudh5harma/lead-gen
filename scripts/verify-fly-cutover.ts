#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  REQUIRED_RESTATE_SERVICES,
  summarizeRestateDeployments,
  type RestateDeploymentSummary,
} from "../core/product/health.ts";
import {
  resolveFlyWorkerHostProbeOptions,
  runFlyWorkerHostProbe,
  type FlyWorkerHostProbeOptions,
} from "./fly-worker-host.ts";
import { legacyAwsWorkflowDeploymentIssues } from "./verify-aws-exit-cutover.ts";
export { flyWorkerIssues, parseFlyAppName, summarizeFlyMachine } from "./fly-worker-host.ts";

type CheckStatus = "ok" | "warn" | "fail";

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface RestateDeploymentsResponse {
  deployments?: Parameters<typeof summarizeRestateDeployments>[0]["deployments"];
}

interface CutoverOptions extends FlyWorkerHostProbeOptions {
  skipRestateCutover: boolean;
  skipRuntimeGates: boolean;
}

const checks: Check[] = [];

function record(name: string, status: CheckStatus, detail: string): void {
  checks.push({ name, status, detail });
  console.log(`  ${status.toUpperCase().padEnd(4, " ")} ${name} - ${detail}`);
}

async function main(): Promise<void> {
  const options = cutoverOptions();
  console.log("Fly cutover checks");

  const workerHost = await runFlyWorkerHostProbe(options);
  for (const check of workerHost.checks) {
    record(check.name, check.status, check.detail);
  }

  if (workerHost.machine) {
    if (options.skipRestateCutover) {
      record(
        "restate.worker_uri",
        "warn",
        "skipped because this is a Fly smoke check, not the production Restate cutover",
      );
      record(
        "legacy.aws_teardown",
        "warn",
        "skipped because this is a Fly smoke check, not the production Restate cutover",
      );
    } else {
      await checkRestateCutover(options.publicUrl);
    }
  } else {
    if (options.skipRestateCutover) {
      record(
        "restate.worker_uri",
        "warn",
        "skipped because this is a Fly smoke check, not the production Restate cutover",
      );
      record(
        "legacy.aws_teardown",
        "warn",
        "skipped because this is a Fly smoke check, not the production Restate cutover",
      );
    } else {
      record(
        "restate.worker_uri",
        "fail",
        "Fly worker URL is unavailable; Restate cannot be verified against the replacement host",
      );
      record(
        "legacy.aws_teardown",
        "warn",
        "skipped until Fly worker and Restate URI checks pass",
      );
    }
  }

  if (hasFailures() || options.skipRuntimeGates) {
    record(
      "cutover.runtime_gates",
      "warn",
      options.skipRuntimeGates
        ? "skipped because this is a Fly smoke check"
        : "skipped until Fly worker and Restate URI checks pass",
    );
    finish();
    return;
  }

  await runRuntimeGates(options);
  finish();
}

async function checkRestateCutover(workerUrl: string): Promise<void> {
  const env = {
    ...process.env,
    ...loadSelectedLocalEnv([
      "RESTATE_ADMIN_URL",
      "RESTATE_INGRESS_URL",
      "RESTATE_BEARER_TOKEN",
      "RESTATE_AUTH_TOKEN",
    ]),
  };
  const admin = restateAdminUrl(env);
  if (!admin) {
    record("restate.admin", "fail", "RESTATE_ADMIN_URL or RESTATE_INGRESS_URL is required");
    return;
  }

  const bearer = restateBearerFromEnv(env);
  const cloudAdmin = new URL(admin).hostname.endsWith(".restate.cloud");
  if (cloudAdmin && !bearer) {
    record("restate.admin", "fail", "Restate Cloud admin API requires RESTATE_BEARER_TOKEN or RESTATE_AUTH_TOKEN");
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${admin}/deployments`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      signal: AbortSignal.timeout(numberFromEnv("RESTATE_ADMIN_TIMEOUT_MS", 10_000)),
    });
  } catch (error) {
    record("restate.admin", "fail", detailFromError(error));
    return;
  }

  const text = await response.text();
  if (!response.ok) {
    record("restate.admin", "fail", `HTTP ${response.status}: ${trimOutput(text)}`);
    return;
  }

  let payload: RestateDeploymentsResponse;
  try {
    payload = JSON.parse(text) as RestateDeploymentsResponse;
  } catch {
    record("restate.admin", "fail", "Restate deployments response was not valid JSON");
    return;
  }

  const summary = summarizeRestateDeployments(payload);
  record(
    "restate.workflow_services",
    summary.missing.length === 0 ? "ok" : "fail",
    summary.missing.length === 0
      ? "all required workflow services are registered"
      : `missing ${summary.missing.join(", ")}`,
  );
  record(
    "restate.workflow_deployments",
    summary.incompleteRequiredDeployments.length === 0 ? "ok" : "fail",
    summary.incompleteRequiredDeployments.length === 0
      ? "every workflow deployment advertises the full required service set"
      : summary.incompleteRequiredDeployments
        .map((deployment) =>
          `${deployment.id ?? "unknown"}@${deployment.uri ?? "unknown"} missing ${
            deployment.missingRequiredServices.join(", ")
          }`
        )
        .join("; "),
  );

  const uriIssues = requiredWorkflowDeploymentUriIssues(summary, workerUrl);
  record(
    "restate.worker_uri",
    uriIssues.length === 0 ? "ok" : "fail",
    uriIssues.length === 0
      ? `all required workflow deployments point at ${normalizeOrigin(workerUrl)}`
      : uriIssues.join("; "),
  );

  const legacyAwsIssues = legacyAwsWorkflowDeploymentIssues(summary);
  record(
    "legacy.aws_teardown",
    legacyAwsIssues.length === 0 ? "ok" : "fail",
    legacyAwsIssues.length === 0
      ? "no required workflow deployment still points at an AWS/ECS host"
      : legacyAwsIssues.join("; "),
  );
}

async function runRuntimeGates(options: CutoverOptions): Promise<void> {
  const restateEnv = loadSelectedLocalEnv([
    "RESTATE_INGRESS_URL",
    "RESTATE_BEARER_TOKEN",
    "RESTATE_AUTH_TOKEN",
  ]);
  const env = {
    ...process.env,
    ...restateEnv,
    RESTATE_BEARER_TOKEN: restateEnv.RESTATE_BEARER_TOKEN
      ?? restateEnv.RESTATE_AUTH_TOKEN
      ?? process.env.RESTATE_BEARER_TOKEN,
    RESTATE_AUTH_TOKEN: restateEnv.RESTATE_AUTH_TOKEN
      ?? restateEnv.RESTATE_BEARER_TOKEN
      ?? process.env.RESTATE_AUTH_TOKEN,
  };

  await runCommandGate("npm.verify_restate", "npm", ["run", "verify:restate"], env);
  await runCommandGate("npm.verify_restate_runtime", "npm", ["run", "verify:restate-runtime"], env);
  await runCommandGate(
    "npm.verify_outreach_pipeline_strict",
    "npm",
    ["run", "verify:outreach-pipeline"],
    { ...process.env, OUTREACH_PIPELINE_STRICT: "1" },
  );
  await runCommandGate(
    "npm.verify_production_app",
    "npm",
    ["run", "verify:production-app"],
    { ...process.env, APP_ORIGIN: options.expectedAppOrigin },
  );
}

async function runCommandGate(
  name: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const result = await command(cmd, args, env);
  record(
    name,
    result.code === 0 ? "ok" : "fail",
    result.code === 0 ? "passed" : trimOutput(result.stdout || result.stderr),
  );
}

export function requiredWorkflowDeploymentUriIssues(
  summary: RestateDeploymentSummary,
  targetUrl: string,
  requiredServices: readonly string[] = REQUIRED_RESTATE_SERVICES,
): string[] {
  const targetOrigin = normalizeOrigin(targetUrl);
  if (!targetOrigin) return [`invalid target worker URL: ${targetUrl}`];

  const requiredServiceSet = new Set(requiredServices);
  const workflowDeployments = summary.deployments.filter((deployment) =>
    deployment.services.some((service) => requiredServiceSet.has(service))
  );
  if (workflowDeployments.length === 0) return ["no required workflow deployments are registered"];

  return workflowDeployments
    .filter((deployment) => normalizeOrigin(deployment.uri ?? "") !== targetOrigin)
    .map((deployment) =>
      `${deployment.id ?? "unknown"}@${deployment.uri ?? "unknown"} still points outside ${targetOrigin}`
    );
}

export function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function cutoverOptions(): CutoverOptions {
  return {
    ...resolveFlyWorkerHostProbeOptions(process.env),
    skipRestateCutover: process.env.FLY_SKIP_RESTATE_CUTOVER?.trim() === "1",
    skipRuntimeGates: process.env.FLY_SKIP_RUNTIME_GATES?.trim() === "1",
  };
}

function restateAdminUrl(env: Record<string, string | undefined>): string | null {
  const explicit = env.RESTATE_ADMIN_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const ingress = env.RESTATE_INGRESS_URL?.trim();
  if (!ingress) return null;

  try {
    const url = new URL(ingress);
    url.port = "9070";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function restateBearerFromEnv(env: Record<string, string | undefined>): string | null {
  return env.RESTATE_BEARER_TOKEN?.trim() || env.RESTATE_AUTH_TOKEN?.trim() || null;
}

function command(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { env, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
        stdout,
        stderr,
      });
    });
  });
}

function loadSelectedLocalEnv(keys: string[]): Record<string, string> {
  if (!existsSync(".env.local")) return {};
  const contents = readFileSync(".env.local", "utf8");
  const env: Record<string, string> = {};
  for (const key of keys) {
    const line = contents.split(/\r?\n/).find((item) => item.startsWith(`${key}=`));
    if (!line) continue;
    let value = line.slice(key.length + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) env[key] = value;
  }
  return env;
}

function trimOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(0, 500) || "no output";
}

function hasFailures(): boolean {
  return checks.some((check) => check.status === "fail");
}

function finish(): void {
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  if (failed.length > 0) {
    console.error(`\n${failed.length} Fly cutover check(s) failed.`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`\nFly cutover passed with ${warnings.length} warning(s).`);
    return;
  }
  console.log("\nFly cutover verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
