import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

type CheckStatus = "ok" | "fail";

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

export interface FlyWorkerHostCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface FlyWorkerHostProbeOptions {
  configFile: string;
  appName: string;
  expectedCpuKind: string;
  expectedCpus: number;
  expectedMemoryMb: number;
  expectedMachineCount: number;
  expectedInternalPort: number;
  expectedAppOrigin: string;
  publicUrl: string;
  healthTimeoutMs: number;
  env: Record<string, string | undefined>;
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

export interface FlyWorkerHostProbeResult {
  ok: boolean;
  checks: FlyWorkerHostCheck[];
  machine: FlyMachineSummary | null;
  publicUrl: string;
  appName: string;
}

export function resolveFlyWorkerHostProbeOptions(
  env: Record<string, string | undefined> = process.env,
): FlyWorkerHostProbeOptions {
  const configFile = env.FLY_CONFIG_FILE?.trim() || "fly.toml";
  const configuredAppName = env.FLY_WORKER_APP_NAME?.trim();
  const fileAppName = readFlyAppName(configFile);
  const appName = configuredAppName || fileAppName || "bombsell-production-worker";
  const publicUrl = env.FLY_WORKER_PUBLIC_URL?.trim() || `https://${appName}.fly.dev`;
  return {
    configFile,
    appName,
    expectedCpuKind: env.FLY_WORKER_EXPECTED_CPU_KIND?.trim() || "shared",
    expectedCpus: numberFromEnv(env, "FLY_WORKER_EXPECTED_CPUS", 2),
    expectedMemoryMb: numberFromEnv(env, "FLY_WORKER_EXPECTED_MEMORY_MB", 1024),
    expectedMachineCount: numberFromEnv(env, "FLY_WORKER_EXPECTED_MACHINE_COUNT", 1),
    expectedInternalPort: numberFromEnv(env, "FLY_WORKER_EXPECTED_INTERNAL_PORT", 8080),
    expectedAppOrigin: env.APP_ORIGIN?.trim() || "https://www.bombsell.com",
    publicUrl,
    healthTimeoutMs: numberFromEnv(env, "FLY_WORKER_HEALTH_TIMEOUT_MS", 10_000),
    env,
  };
}

export async function runFlyWorkerHostProbe(
  options: FlyWorkerHostProbeOptions = resolveFlyWorkerHostProbeOptions(),
): Promise<FlyWorkerHostProbeResult> {
  const checks: FlyWorkerHostCheck[] = [];

  const configResult = await command(
    flyCli(options.env),
    ["config", "validate", "--strict", "-c", options.configFile],
    options.env,
  );
  checks.push({
    name: "fly.config",
    status: configResult.code === 0 ? "ok" : "fail",
    detail:
      configResult.code === 0
        ? `${options.configFile} validates for Fly`
        : trimOutput(configResult.stderr || configResult.stdout),
  });

  const machineResult = await command(
    flyCli(options.env),
    ["machine", "list", "--json", "-a", options.appName],
    options.env,
  );
  if (machineResult.code !== 0) {
    checks.push({
      name: "fly.worker.machine",
      status: "fail",
      detail: trimOutput(machineResult.stderr || machineResult.stdout),
    });
    checks.push({
      name: "fly.worker.health",
      status: "fail",
      detail: `Fly worker URL is unavailable; create and deploy ${options.appName} first`,
    });
    return {
      ok: false,
      checks,
      machine: null,
      publicUrl: options.publicUrl,
      appName: options.appName,
    };
  }

  let entries: FlyMachineEntry[];
  try {
    entries = parseJsonOutput<FlyMachineEntry[]>(machineResult.stdout);
  } catch (error) {
    checks.push({
      name: "fly.worker.machine",
      status: "fail",
      detail: detailFromError(error),
    });
    checks.push({
      name: "fly.worker.health",
      status: "fail",
      detail: `Fly worker URL is unavailable; create and deploy ${options.appName} first`,
    });
    return {
      ok: false,
      checks,
      machine: null,
      publicUrl: options.publicUrl,
      appName: options.appName,
    };
  }

  const machines = entries
    .map(summarizeFlyMachine)
    .filter((machine): machine is FlyMachineSummary => machine !== null);
  const activeMachines = machines.filter((machine) => machine.state && machine.state !== "destroyed");
  const startedMachines = activeMachines.filter((machine) => machine.state === "started");

  if (startedMachines.length === 0) {
    checks.push({
      name: "fly.worker.machine",
      status: "fail",
      detail: `no started Fly Machines found for ${options.appName}`,
    });
    checks.push({
      name: "fly.worker.health",
      status: "fail",
      detail: `Fly worker URL is unavailable; create and deploy ${options.appName} first`,
    });
    return {
      ok: false,
      checks,
      machine: null,
      publicUrl: options.publicUrl,
      appName: options.appName,
    };
  }

  if (startedMachines.length !== options.expectedMachineCount) {
    checks.push({
      name: "fly.worker.machine",
      status: "fail",
      detail: `started machine count is ${startedMachines.length}, expected ${options.expectedMachineCount}; use fly deploy --ha=false or fly scale count ${options.expectedMachineCount}`,
    });
    checks.push({
      name: "fly.worker.health",
      status: "fail",
      detail: `Fly worker URL is unavailable; create and deploy ${options.appName} first`,
    });
    return {
      ok: false,
      checks,
      machine: null,
      publicUrl: options.publicUrl,
      appName: options.appName,
    };
  }

  checks.push({
    name: "fly.worker.machine_count",
    status: activeMachines.length === options.expectedMachineCount ? "ok" : "fail",
    detail:
      activeMachines.length === options.expectedMachineCount
        ? `${activeMachines.length} active Fly Machine running for ${options.appName}`
        : `active machine count is ${activeMachines.length}, expected ${options.expectedMachineCount}; remove extra Machines to keep the cost floor predictable`,
  });

  const machine = startedMachines[0];
  const issues = flyWorkerIssues(machine, options);
  checks.push({
    name: "fly.worker.machine",
    status: issues.length === 0 ? "ok" : "fail",
    detail:
      issues.length === 0
        ? `${machine.id ?? "unknown machine"} ${machine.region ?? "unknown region"} shared ${machine.cpus ?? "?"} CPU / ${machine.memoryMb ?? "?"} MB`
        : issues.join("; "),
  });

  try {
    const response = await fetch(`${options.publicUrl.replace(/\/$/, "")}/health`, {
      headers: { Accept: "application/json,text/plain;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(options.healthTimeoutMs),
    });
    checks.push({
      name: "fly.worker.health",
      status: response.ok ? "ok" : "fail",
      detail: `HTTP ${response.status} from ${options.publicUrl.replace(/\/$/, "")}/health`,
    });
  } catch (error) {
    checks.push({
      name: "fly.worker.health",
      status: "fail",
      detail: detailFromError(error),
    });
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
    machine,
    publicUrl: options.publicUrl,
    appName: options.appName,
  };
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
    FlyWorkerHostProbeOptions,
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

export function parseFlyAppName(configContents: string): string | null {
  const match = configContents.match(/^\s*app\s*=\s*["']([^"']+)["']/m);
  return match?.[1]?.trim() || null;
}

function readFlyAppName(configFile: string): string | null {
  if (!existsSync(configFile)) return null;
  return parseFlyAppName(readFileSync(configFile, "utf8"));
}

function flyCli(env: Record<string, string | undefined>): string {
  const explicit = env.FLY_CLI?.trim();
  if (explicit) return explicit;
  const home = homedir();
  return home ? `${home}/.fly/bin/flyctl` : "flyctl";
}

function command(
  cmd: string,
  args: string[],
  env: Record<string, string | undefined>,
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

function parseJsonOutput<T>(value: string): T {
  return JSON.parse(value) as T;
}

function normalizeEnv(env: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined) continue;
    normalized[key] = String(value);
  }
  return normalized;
}

function normalizeAutoStop(value: string | boolean | undefined): string | null {
  if (typeof value === "boolean") return value ? "on" : "off";
  return value ?? null;
}

function numberFromEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
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
