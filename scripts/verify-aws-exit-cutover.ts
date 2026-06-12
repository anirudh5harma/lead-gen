#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  REQUIRED_RESTATE_SERVICES,
  summarizeRestateDeployments,
  type RestateDeploymentSummary,
} from "../core/product/health.ts";

type CheckStatus = "ok" | "warn" | "fail";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface RenderBlueprintValidation {
  valid?: boolean;
  errors?: Array<{
    error?: string;
    path?: string;
    line?: number;
    column?: number;
  }>;
}

interface RenderServiceEntry {
  service?: {
    id?: string;
    name?: string;
    type?: string;
    suspended?: string;
    dashboardUrl?: string;
    serviceDetails?: {
      plan?: string;
      runtime?: string;
      env?: string;
      numInstances?: number;
      healthCheckPath?: string;
      url?: string;
    };
  };
}

export interface RenderWorkerSummary {
  id: string | null;
  name: string;
  type: string | null;
  plan: string | null;
  runtime: string | null;
  numInstances: number | null;
  healthCheckPath: string | null;
  url: string | null;
  suspended: string | null;
  dashboardUrl: string | null;
}

interface RestateDeploymentsResponse {
  deployments?: Parameters<typeof summarizeRestateDeployments>[0]["deployments"];
}

interface CutoverOptions {
  blueprintFile: string;
  serviceName: string;
  expectedPlan: string;
  allowFreeWorker: boolean;
  skipRestateCutover: boolean;
  skipRuntimeGates: boolean;
  appOrigin: string;
}

const checks: Check[] = [];

function record(name: string, status: CheckStatus, detail: string): void {
  checks.push({ name, status, detail });
  console.log(`  ${status.toUpperCase().padEnd(4, " ")} ${name} - ${detail}`);
}

async function main(): Promise<void> {
  const options = cutoverOptions();
  console.log("AWS exit cutover checks");

  await checkRenderBlueprint(options);
  const worker = await checkRenderWorker(options);
  if (worker?.url) {
    await checkRenderHealth(worker.url);
    if (options.skipRestateCutover) {
      record(
        "restate.worker_uri",
        "warn",
        "skipped because this is a Render smoke check, not the production Restate cutover",
      );
    } else {
      await checkRestateCutover(worker.url);
    }
  } else {
    record(
      "render.worker.health",
      "fail",
      `Render worker URL is unavailable; create ${options.serviceName} first`,
    );
    if (options.skipRestateCutover) {
      record(
        "restate.worker_uri",
        "warn",
        "skipped because this is a Render smoke check, not the production Restate cutover",
      );
    } else {
      record(
        "restate.worker_uri",
        "fail",
        "Render worker URL is unavailable; Restate cannot be verified against the replacement host",
      );
    }
  }

  if (hasFailures() || options.skipRuntimeGates) {
    record(
      "cutover.runtime_gates",
      options.skipRuntimeGates ? "warn" : "warn",
      options.skipRuntimeGates
        ? "skipped because this is a Render smoke check"
        : "skipped until Render worker and Restate URI checks pass",
    );
    finish();
    return;
  }

  await runRuntimeGates(options);
  finish();
}

async function checkRenderBlueprint(options: CutoverOptions): Promise<void> {
  const result = await command(renderCli(), [
    "blueprints",
    "validate",
    options.blueprintFile,
    "--output",
    "json",
    "--confirm",
  ]);
  if (result.code !== 0) {
    record("render.blueprint", "fail", trimOutput(result.stderr || result.stdout));
    return;
  }

  let payload: RenderBlueprintValidation;
  try {
    payload = JSON.parse(result.stdout) as RenderBlueprintValidation;
  } catch {
    record("render.blueprint", "fail", `Render validation returned non-JSON: ${trimOutput(result.stdout)}`);
    return;
  }

  if (payload.valid === true) {
    record("render.blueprint", "ok", `${options.blueprintFile} validates for the active workspace`);
    return;
  }

  const errors = payload.errors ?? [];
  const needPayment = errors.some((error) => error.error === "need_payment_info");
  record(
    "render.blueprint",
    "fail",
    needPayment
      ? `Render workspace needs payment information before ${options.blueprintFile} can be created`
      : formatRenderErrors(errors),
  );
}

async function checkRenderWorker(options: CutoverOptions): Promise<RenderWorkerSummary | null> {
  const result = await command(renderCli(), ["services", "--output", "json"]);
  if (result.code !== 0) {
    record("render.worker.service", "fail", trimOutput(result.stderr || result.stdout));
    return null;
  }

  let entries: RenderServiceEntry[];
  try {
    entries = JSON.parse(result.stdout) as RenderServiceEntry[];
  } catch {
    record("render.worker.service", "fail", `Render services returned non-JSON: ${trimOutput(result.stdout)}`);
    return null;
  }

  const worker = findRenderWorker(entries, options.serviceName);
  if (!worker) {
    record(
      "render.worker.service",
      "fail",
      `${options.serviceName} is not present in the active Render workspace`,
    );
    return null;
  }

  const issues = renderWorkerIssues(worker, {
    expectedPlan: options.expectedPlan,
    allowFreeWorker: options.allowFreeWorker,
  });
  const allowedFree = options.allowFreeWorker && worker.plan === "free";
  record(
    "render.worker.service",
    issues.length === 0 ? (allowedFree ? "warn" : "ok") : "fail",
    issues.length === 0
      ? allowedFree
        ? `${worker.name} is on Render Free for smoke only; do not scale ECS down from this signal`
        : `${worker.name} ${worker.plan ?? "unknown plan"} ${worker.url ?? "unknown URL"}`
      : issues.join("; "),
  );
  return worker;
}

async function checkRenderHealth(workerUrl: string): Promise<void> {
  const healthUrl = `${workerUrl.replace(/\/$/, "")}/health`;
  try {
    const response = await fetch(healthUrl, {
      headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(numberFromEnv("RENDER_WORKER_HEALTH_TIMEOUT_MS", 10_000)),
    });
    record(
      "render.worker.health",
      response.ok ? "ok" : "fail",
      response.ok ? `HTTP ${response.status} from ${healthUrl}` : `HTTP ${response.status} from ${healthUrl}`,
    );
  } catch (error) {
    record("render.worker.health", "fail", detailFromError(error));
  }
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
    { ...process.env, APP_ORIGIN: options.appOrigin },
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

export function findRenderWorker(
  entries: RenderServiceEntry[],
  serviceName: string,
): RenderWorkerSummary | null {
  for (const entry of entries) {
    const summary = summarizeRenderService(entry);
    if (summary?.name === serviceName) return summary;
  }
  return null;
}

export function summarizeRenderService(entry: RenderServiceEntry): RenderWorkerSummary | null {
  const service = entry.service;
  if (!service?.name) return null;
  const details = service.serviceDetails ?? {};
  return {
    id: service.id ?? null,
    name: service.name,
    type: service.type ?? null,
    plan: details.plan ?? null,
    runtime: details.runtime ?? details.env ?? null,
    numInstances: typeof details.numInstances === "number" ? details.numInstances : null,
    healthCheckPath: details.healthCheckPath ?? null,
    url: details.url ?? null,
    suspended: service.suspended ?? null,
    dashboardUrl: service.dashboardUrl ?? null,
  };
}

export function renderWorkerIssues(
  worker: RenderWorkerSummary,
  opts: { expectedPlan: string; allowFreeWorker?: boolean },
): string[] {
  const issues: string[] = [];
  if (worker.type !== "web_service") issues.push(`type is ${worker.type ?? "missing"}, expected web_service`);
  if (worker.plan !== opts.expectedPlan) {
    issues.push(`plan is ${worker.plan ?? "missing"}, expected ${opts.expectedPlan}`);
  }
  if (worker.plan === "free" && !opts.allowFreeWorker) {
    issues.push("free Render services sleep and are not valid for this always-on worker");
  }
  if (worker.runtime !== "docker") issues.push(`runtime is ${worker.runtime ?? "missing"}, expected docker`);
  if ((worker.numInstances ?? 0) < 1) issues.push("numInstances must be at least 1");
  if (worker.healthCheckPath !== "/health") {
    issues.push(`healthCheckPath is ${worker.healthCheckPath ?? "missing"}, expected /health`);
  }
  if (!worker.url) issues.push("public service URL is missing");
  if (worker.suspended && worker.suspended !== "not_suspended") {
    issues.push(`service is suspended: ${worker.suspended}`);
  }
  return issues;
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
    blueprintFile: process.env.RENDER_BLUEPRINT_FILE?.trim() || "render.yaml",
    serviceName: process.env.RENDER_WORKER_SERVICE_NAME?.trim() || "bombsell-production-worker",
    expectedPlan: process.env.RENDER_WORKER_EXPECTED_PLAN?.trim() || "standard",
    allowFreeWorker: process.env.RENDER_ALLOW_FREE_WORKER?.trim() === "1",
    skipRestateCutover: process.env.RENDER_SKIP_RESTATE_CUTOVER?.trim() === "1",
    skipRuntimeGates: process.env.RENDER_SKIP_RUNTIME_GATES?.trim() === "1",
    appOrigin: process.env.APP_ORIGIN?.trim() || "https://www.bombsell.com",
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

function renderCli(): string {
  const explicit = process.env.RENDER_CLI?.trim();
  if (explicit) return explicit;
  const home = homedir();
  return home ? `${home}/.local/bin/render` : "render";
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

function formatRenderErrors(errors: NonNullable<RenderBlueprintValidation["errors"]>): string {
  if (errors.length === 0) return "Render blueprint validation failed without details";
  return errors
    .map((error) =>
      `${error.error ?? "unknown"} at ${error.path ?? "unknown"}${
        error.line ? `:${error.line}` : ""
      }`
    )
    .join("; ");
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function trimOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(0, 500) || "no output";
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function hasFailures(): boolean {
  return checks.some((check) => check.status === "fail");
}

function finish(): void {
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  if (failed.length > 0) {
    console.error(`\n${failed.length} AWS exit cutover check(s) failed.`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`\nAWS exit cutover passed with ${warnings.length} warning(s).`);
    return;
  }
  console.log("\nAWS exit cutover verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
