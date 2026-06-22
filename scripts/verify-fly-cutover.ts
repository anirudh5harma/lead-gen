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

interface FlyMachineEntry {
  id?: string;
  name?: string;
  state?: string;
  region?: string;
  config?: {
    env?: Record<string, unknown> | null;
    guest?: {
      cpu_kind?: string;
      cpus?: number;
      memory_mb?: number;
    } | null;
    restart?: {
      policy?: string;
      max_retries?: number;
    } | null;
    services?: Array<{
      internal_port?: number;
      autostart?: boolean;
      autostop?: string | boolean;
      min_machines_running?: number;
    }> | null;
  } | null;
}

interface RestateDeploymentsResponse {
  deployments?: Parameters<typeof summarizeRestateDeployments>[0]["deployments"];
}

interface CutoverOptions {
  configFile: string;
  appName: string;
  expectedCpuKind: string;
  expectedCpus: number;
  expectedMemoryMb: number;
  expectedMachineCount: number;
  expectedInternalPort: number;
  expectedAppOrigin: string;
  publicUrl: string;
  skipRestateCutover: boolean;
  skipRuntimeGates: boolean;
}

export interface FlyMachineSummary {
  id: string | null;
  name: string | null;
  state: string | null;
  region: string | null;
  cpuKind: string | null;
  cpus: number | null;
  memoryMb: number | null;
  restartPolicy: string | null;
  restartRetries: number | null;
  internalPort: number | null;
  autoStart: boolean | null;
  autoStop: string | null;
  minMachinesRunning: number | null;
  env: Record<string, string>;
}

const checks: Check[] = [];

function record(name: string, status: CheckStatus, detail: string): void {
  checks.push({ name, status, detail });
  console.log(`  ${status.toUpperCase().padEnd(4, " ")} ${name} - ${detail}`);
}

async function main(): Promise<void> {
  const options = cutoverOptions();
  console.log("Fly cutover checks");

  await checkFlyConfig(options);
  const machine = await checkFlyWorker(options);
  if (machine) {
    await checkFlyHealth(options.publicUrl);
    if (options.skipRestateCutover) {
      record(
        "restate.worker_uri",
        "warn",
        "skipped because this is a Fly smoke check, not the production Restate cutover",
      );
    } else {
      await checkRestateCutover(options.publicUrl);
    }
  } else {
    record(
      "fly.worker.health",
      "fail",
      `Fly worker URL is unavailable; create and deploy ${options.appName} first`,
    );
    if (options.skipRestateCutover) {
      record(
        "restate.worker_uri",
        "warn",
        "skipped because this is a Fly smoke check, not the production Restate cutover",
      );
    } else {
      record(
        "restate.worker_uri",
        "fail",
        "Fly worker URL is unavailable; Restate cannot be verified against the replacement host",
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

async function checkFlyConfig(options: CutoverOptions): Promise<void> {
  const result = await command(flyCli(), [
    "config",
    "validate",
    "--strict",
    "-c",
    options.configFile,
  ]);
  record(
    "fly.config",
    result.code === 0 ? "ok" : "fail",
    result.code === 0
      ? `${options.configFile} validates for Fly`
      : trimOutput(result.stderr || result.stdout),
  );
}

async function checkFlyWorker(options: CutoverOptions): Promise<FlyMachineSummary | null> {
  const result = await command(flyCli(), [
    "machine",
    "list",
    "--json",
    "-a",
    options.appName,
  ]);
  if (result.code !== 0) {
    record("fly.worker.machine", "fail", trimOutput(result.stderr || result.stdout));
    return null;
  }

  let entries: FlyMachineEntry[];
  try {
    entries = parseJsonOutput<FlyMachineEntry[]>(result.stdout);
  } catch (error) {
    record("fly.worker.machine", "fail", detailFromError(error));
    return null;
  }

  const machines = entries.map(summarizeFlyMachine).filter((machine): machine is FlyMachineSummary => machine !== null);
  const activeMachines = machines.filter((machine) => machine.state && machine.state !== "destroyed");
  const startedMachines = activeMachines.filter((machine) => machine.state === "started");

  if (startedMachines.length === 0) {
    record("fly.worker.machine", "fail", `no started Fly Machines found for ${options.appName}`);
    return null;
  }

  if (startedMachines.length !== options.expectedMachineCount) {
    record(
      "fly.worker.machine",
      "fail",
      `started machine count is ${startedMachines.length}, expected ${options.expectedMachineCount}; use fly deploy --ha=false or fly scale count ${options.expectedMachineCount}`,
    );
    return null;
  }

  if (activeMachines.length !== options.expectedMachineCount) {
    record(
      "fly.worker.machine_count",
      "fail",
      `active machine count is ${activeMachines.length}, expected ${options.expectedMachineCount}; remove extra Machines to keep the cost floor predictable`,
    );
  } else {
    record(
      "fly.worker.machine_count",
      "ok",
      `${activeMachines.length} active Fly Machine running for ${options.appName}`,
    );
  }

  const machine = startedMachines[0];
  const issues = flyWorkerIssues(machine, options);
  record(
    "fly.worker.machine",
    issues.length === 0 ? "ok" : "fail",
    issues.length === 0
      ? `${machine.id ?? "unknown machine"} ${machine.region ?? "unknown region"} shared ${machine.cpus ?? "?"} CPU / ${machine.memoryMb ?? "?"} MB`
      : issues.join("; "),
  );
  return machine;
}

async function checkFlyHealth(workerUrl: string): Promise<void> {
  const healthUrl = `${workerUrl.replace(/\/$/, "")}/health`;
  try {
    const response = await fetch(healthUrl, {
      headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(numberFromEnv("FLY_WORKER_HEALTH_TIMEOUT_MS", 10_000)),
    });
    record(
      "fly.worker.health",
      response.ok ? "ok" : "fail",
      `HTTP ${response.status} from ${healthUrl}`,
    );
  } catch (error) {
    record("fly.worker.health", "fail", detailFromError(error));
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

export function summarizeFlyMachine(entry: FlyMachineEntry): FlyMachineSummary | null {
  if (!entry.id && !entry.name) return null;
  const guest = entry.config?.guest ?? null;
  const restart = entry.config?.restart ?? null;
  const service = entry.config?.services?.[0] ?? null;
  const env = normalizeEnv(entry.config?.env ?? {});
  return {
    id: entry.id ?? null,
    name: entry.name ?? null,
    state: entry.state ?? null,
    region: entry.region ?? null,
    cpuKind: guest?.cpu_kind ?? null,
    cpus: typeof guest?.cpus === "number" ? guest.cpus : null,
    memoryMb: typeof guest?.memory_mb === "number" ? guest.memory_mb : null,
    restartPolicy: restart?.policy ?? null,
    restartRetries: typeof restart?.max_retries === "number" ? restart.max_retries : null,
    internalPort: typeof service?.internal_port === "number" ? service.internal_port : null,
    autoStart: typeof service?.autostart === "boolean" ? service.autostart : null,
    autoStop: normalizeAutoStop(service?.autostop),
    minMachinesRunning:
      typeof service?.min_machines_running === "number" ? service.min_machines_running : null,
    env,
  };
}

export function flyWorkerIssues(
  machine: FlyMachineSummary,
  options: Pick<
    CutoverOptions,
    | "expectedCpuKind"
    | "expectedCpus"
    | "expectedMemoryMb"
    | "expectedInternalPort"
    | "expectedAppOrigin"
  >,
): string[] {
  const issues: string[] = [];
  if (machine.state !== "started") issues.push(`state is ${machine.state ?? "missing"}, expected started`);
  if (machine.cpuKind !== options.expectedCpuKind) {
    issues.push(`cpu kind is ${machine.cpuKind ?? "missing"}, expected ${options.expectedCpuKind}`);
  }
  if (machine.cpus !== options.expectedCpus) {
    issues.push(`cpu count is ${machine.cpus ?? "missing"}, expected ${options.expectedCpus}`);
  }
  if (machine.memoryMb !== options.expectedMemoryMb) {
    issues.push(`memory is ${machine.memoryMb ?? "missing"} MB, expected ${options.expectedMemoryMb} MB`);
  }
  if (machine.internalPort !== options.expectedInternalPort) {
    issues.push(`internal port is ${machine.internalPort ?? "missing"}, expected ${options.expectedInternalPort}`);
  }
  if (machine.autoStart !== true) issues.push("autostart must be true");
  if (machine.autoStop !== "off") issues.push(`autostop is ${machine.autoStop ?? "missing"}, expected off`);
  if (machine.minMachinesRunning !== 1) {
    issues.push(`min_machines_running is ${machine.minMachinesRunning ?? "missing"}, expected 1`);
  }
  if (machine.restartPolicy !== "on-failure") {
    issues.push(`restart policy is ${machine.restartPolicy ?? "missing"}, expected on-failure`);
  }
  if (machine.restartRetries !== 10) {
    issues.push(`restart retries are ${machine.restartRetries ?? "missing"}, expected 10`);
  }
  if (machine.env.WORKER_COMMAND !== "worker:production") {
    issues.push(`WORKER_COMMAND is ${machine.env.WORKER_COMMAND ?? "missing"}, expected worker:production`);
  }
  if (machine.env.RESTATE_WORKFLOW_HTTP1 !== "1") {
    issues.push(`RESTATE_WORKFLOW_HTTP1 is ${machine.env.RESTATE_WORKFLOW_HTTP1 ?? "missing"}, expected 1`);
  }
  if (machine.env.RESTATE_WORKFLOW_PORT !== String(options.expectedInternalPort)) {
    issues.push(
      `RESTATE_WORKFLOW_PORT is ${machine.env.RESTATE_WORKFLOW_PORT ?? "missing"}, expected ${options.expectedInternalPort}`,
    );
  }
  if (machine.env.APP_ORIGIN !== options.expectedAppOrigin) {
    issues.push(`APP_ORIGIN is ${machine.env.APP_ORIGIN ?? "missing"}, expected ${options.expectedAppOrigin}`);
  }
  if (machine.env.MANAGED_OWNED_DOMAIN_EMAIL_ENABLED !== "0") {
    issues.push(
      `MANAGED_OWNED_DOMAIN_EMAIL_ENABLED is ${machine.env.MANAGED_OWNED_DOMAIN_EMAIL_ENABLED ?? "missing"}, expected 0`,
    );
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

export function parseFlyAppName(configContents: string): string | null {
  const match = configContents.match(/^\s*app\s*=\s*["']([^"']+)["']/m);
  return match?.[1]?.trim() || null;
}

function cutoverOptions(): CutoverOptions {
  const configFile = process.env.FLY_CONFIG_FILE?.trim() || "fly.toml";
  const configuredAppName = process.env.FLY_WORKER_APP_NAME?.trim();
  const fileAppName = readFlyAppName(configFile);
  const appName = configuredAppName || fileAppName || "bombsell-production-worker";
  const publicUrl = process.env.FLY_WORKER_PUBLIC_URL?.trim() || `https://${appName}.fly.dev`;
  return {
    configFile,
    appName,
    expectedCpuKind: process.env.FLY_WORKER_EXPECTED_CPU_KIND?.trim() || "shared",
    expectedCpus: numberFromEnv("FLY_WORKER_EXPECTED_CPUS", 2),
    expectedMemoryMb: numberFromEnv("FLY_WORKER_EXPECTED_MEMORY_MB", 1024),
    expectedMachineCount: numberFromEnv("FLY_WORKER_EXPECTED_MACHINE_COUNT", 1),
    expectedInternalPort: numberFromEnv("FLY_WORKER_EXPECTED_INTERNAL_PORT", 8080),
    expectedAppOrigin: process.env.APP_ORIGIN?.trim() || "https://www.bombsell.com",
    publicUrl,
    skipRestateCutover: process.env.FLY_SKIP_RESTATE_CUTOVER?.trim() === "1",
    skipRuntimeGates: process.env.FLY_SKIP_RUNTIME_GATES?.trim() === "1",
  };
}

function readFlyAppName(configFile: string): string | null {
  if (!existsSync(configFile)) return null;
  return parseFlyAppName(readFileSync(configFile, "utf8"));
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

function flyCli(): string {
  const explicit = process.env.FLY_CLI?.trim();
  if (explicit) return explicit;
  const home = homedir();
  if (home && existsSync(`${home}/.fly/bin/flyctl`)) return `${home}/.fly/bin/flyctl`;
  if (home && existsSync(`${home}/.fly/bin/fly`)) return `${home}/.fly/bin/fly`;
  return "flyctl";
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

function normalizeEnv(raw: Record<string, unknown>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function normalizeAutoStop(value: string | boolean | undefined): string | null {
  if (typeof value === "string") return value;
  if (value === true) return "stop";
  if (value === false) return "off";
  return null;
}

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Fly command returned empty JSON output");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) throw new Error("Fly command returned empty JSON output");
    return lines.map((line) => JSON.parse(line)) as T;
  }
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
