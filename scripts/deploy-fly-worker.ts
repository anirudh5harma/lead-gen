#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { REQUIRED_RESTATE_SERVICES } from "../core/product/health.ts";

const REQUIRED_SECRET_KEYS = [
  "APP_ORIGIN",
  "CREDENTIALS_ENCRYPTION_KEY",
  "DATABASE_URL",
  "DEEPSEEK_API_KEY",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "NATS_URL",
  "OPENAI_API_KEY",
  "RESTATE_INGRESS_URL",
] as const;

const RECOMMENDED_SECRET_KEYS = [
  "FIRECRAWL_API_KEY",
] as const;

const CONDITIONAL_SECRET_GROUPS = [
  ["HUNTER_API_KEY", "EXA_API_KEY"],
  ["HUNTER_API_KEY", "ZEROBOUNCE_API_KEY"],
  ["RESTATE_BEARER_TOKEN", "RESTATE_AUTH_TOKEN"],
] as const;

const OPTIONAL_SECRET_KEYS = [
  "DATABASE_POOL_MAX",
  "WORKER_DATABASE_POOL_MAX",
  "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
  "DATABASE_POOL_IDLE_TIMEOUT_MS",
  "NATS_CREDS",
  "NATS_STREAM_MAX_BYTES",
  "NATS_STREAM_MAX_AGE_MS",
  "RESTATE_ADMIN_URL",
  "RESTATE_BEARER_TOKEN",
  "RESTATE_AUTH_TOKEN",
  "RESTATE_ADMIN_TIMEOUT_MS",
  "EXA_API_KEY",
  "FIRECRAWL_API_URL",
  "HUNTER_API_KEY",
  "HUNTER_API_BASE_URL",
  "ZEROBOUNCE_API_KEY",
  "ZEROBOUNCE_API_BASE_URL",
  "BOMBSELL_EXA_DAILY_QUERY_CAP",
  "BOMBSELL_EXA_DAILY_CONTENTS_CAP",
  "BOMBSELL_EXA_MONTHLY_UNIT_CAP",
  "BOMBSELL_EXA_PLAY_RESEARCH_CAP",
  "BOMBSELL_RECOMMENDATION_RESEARCH_CADENCE_HOURS",
  "PRODUCT_EVENT_DISPATCH_LIMIT",
  "PRODUCT_REDRIVE_SIGNAL_LIMIT",
  "PRODUCT_REDRIVE_REPLY_LIMIT",
  "PRODUCT_REDRIVE_RECOMMENDATION_LIMIT",
  "PRODUCT_SIGNAL_MATCHING_DISPATCH_INTERVAL_MS",
  "NATS_DISPATCH_REDRIVE_LIMIT",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_PROMPT_USD_PER_MILLION",
  "DEEPSEEK_COMPLETION_USD_PER_MILLION",
  "BOMBSELL_LLM_DAILY_TOKEN_CAP",
  "LINKEDIN_PROVIDER_URL",
  "LINKEDIN_PROVIDER_AUTH_URL",
  "LINKEDIN_PROVIDER_HEALTH_URL",
  "LINKEDIN_PROVIDER_API_KEY",
  "LINKEDIN_PROVIDER_WEBHOOK_SECRET",
  "LINKEDIN_REDIRECT_URI",
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_REDIRECT_URI",
  "OUTLOOK_DEFAULT_DAILY_CAP",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "TWITTERAPI_IO_API_KEY",
  "SOCIALDATA_API_KEY",
  "X_API_BEARER_TOKEN",
  "PRODUCT_HUNT_TOKEN",
  "REDDIT_USER_AGENT",
  "SEC_EDGAR_USER_AGENT",
  "SIGNAL_WEBHOOK_SECRET",
  "AWS_REGION",
  "AWS_SNS_TOPIC_ARNS",
  "AWS_SES_REQUIRED",
  "SES_SENDING_DOMAIN",
  "SES_CONFIGURATION_SET",
  "SNS_VERIFY_SIGNATURES",
] as const;

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface DeployOptions {
  appName: string;
  configFile: string;
  orgSlug: string | null;
}

export interface FlySecretPair {
  key: string;
  value: string;
}

export interface FlySecretCollection {
  secrets: FlySecretPair[];
  missingRequiredKeys: string[];
  missingRecommendedKeys: string[];
}

async function main(): Promise<void> {
  loadDotenvFile(".env.local");
  loadDotenvFile(".env");

  const options = deployOptions();
  const authOk = await ensureFlyAuth();
  if (!authOk) {
    die("Fly auth is required. Set FLY_API_TOKEN or run ~/.fly/bin/flyctl auth login first.");
  }

  const secrets = collectFlyWorkerSecrets(process.env);
  if (secrets.missingRequiredKeys.length > 0) {
    die(
      `Missing Fly worker deployment secrets: ${secrets.missingRequiredKeys.join(", ")}`,
    );
  }
  if (secrets.missingRecommendedKeys.length > 0) {
    console.warn(
      `[fly-worker] continuing without recommended secrets: ${secrets.missingRecommendedKeys.join(", ")}`,
    );
  }
  if (secrets.secrets.length === 0) {
    die("No Fly worker secrets were collected from the current environment.");
  }

  console.log(`[fly-worker] ensuring app ${options.appName}`);
  await ensureFlyApp(options);

  console.log(
    `[fly-worker] syncing ${secrets.secrets.length} secrets to ${options.appName}`,
  );
  await setFlySecrets(options.appName, secrets.secrets);

  console.log(
    `[fly-worker] deploying ${options.appName} with shared-cpu-2x / 1gb and --ha=false`,
  );
  await deployFlyApp(options);

  console.log(`[fly-worker] forcing active machine count to 1`);
  await scaleFlyAppToOne(options.appName);

  const workerUrl = `https://${options.appName}.fly.dev`;
  console.log(`[fly-worker] waiting for ${workerUrl}/health`);
  await waitForWorkerHealth(workerUrl);

  console.log(`[fly-worker] registering ${workerUrl} with Restate`);
  const registered = await registerRestateDeployment(workerUrl, process.env);
  console.log(
    `[fly-worker] deployed and registered ${registered.serviceCount} required Restate services`,
  );
  console.log("[fly-worker] run npm run verify:fly-cutover for the complete production gate");
}

export function collectFlyWorkerSecrets(
  env: Record<string, string | undefined>,
): FlySecretCollection {
  const secrets = new Map<string, string>();
  const missingRequiredKeys = REQUIRED_SECRET_KEYS.filter((key) => !hasEnvValue(env[key]));
  const missingRecommendedKeys = RECOMMENDED_SECRET_KEYS.filter((key) => !hasEnvValue(env[key]));

  for (const group of CONDITIONAL_SECRET_GROUPS) {
    if (!group.some((key) => hasEnvValue(env[key]))) {
      missingRequiredKeys.push(`${group.join(" | ")}`);
    }
  }

  for (const key of [...REQUIRED_SECRET_KEYS, ...RECOMMENDED_SECRET_KEYS, ...OPTIONAL_SECRET_KEYS]) {
    const value = resolveSecretValue(key, env);
    if (!value) continue;
    secrets.set(key, value);
  }

  return {
    secrets: [...secrets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value })),
    missingRequiredKeys,
    missingRecommendedKeys,
  };
}

export function parseFlyAppName(configContents: string): string | null {
  const match = configContents.match(/^\s*app\s*=\s*["']([^"']+)["']/m);
  return match?.[1]?.trim() || null;
}

export function normalizePersistentWorkerDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.hostname.endsWith(".pooler.supabase.com") &&
      url.port === "6543"
    ) {
      url.port = "5432";
      return url.toString();
    }
  } catch {
    return value;
  }
  return value;
}

export function restateAdminUrl(
  env: Record<string, string | undefined>,
): string | null {
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

export async function registerRestateDeployment(
  workerUrl: string,
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ serviceCount: number }> {
  const adminUrl = restateAdminUrl(env);
  if (!adminUrl) {
    throw new Error("RESTATE_ADMIN_URL or RESTATE_INGRESS_URL is required after deployment");
  }
  const bearer = env.RESTATE_BEARER_TOKEN?.trim() || env.RESTATE_AUTH_TOKEN?.trim();
  if (new URL(adminUrl).hostname.endsWith(".restate.cloud") && !bearer) {
    throw new Error("Restate Cloud registration requires RESTATE_BEARER_TOKEN or RESTATE_AUTH_TOKEN");
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetchImpl(`${adminUrl}/deployments`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      uri: `${workerUrl.replace(/\/$/, "")}/`,
      force: true,
      use_http_11: true,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `Restate deployment registration failed (HTTP ${response.status}): ${trimOutput(raw)}`,
    );
  }
  const payload = JSON.parse(raw) as { services?: Array<{ name?: string }> };
  const advertised = new Set(
    (payload.services ?? []).flatMap((service) =>
      typeof service.name === "string" ? [service.name] : []
    ),
  );
  const missing = REQUIRED_RESTATE_SERVICES.filter((service) => !advertised.has(service));
  if (missing.length > 0) {
    throw new Error(`Restate discovery omitted required services: ${missing.join(", ")}`);
  }
  return { serviceCount: advertised.size };
}

function deployOptions(): DeployOptions {
  const configFile = process.env.FLY_CONFIG_FILE?.trim() || "fly.toml";
  const appName =
    process.env.FLY_WORKER_APP_NAME?.trim() || readFlyAppName(configFile) || "bombsell-production-worker";
  return {
    appName,
    configFile,
    orgSlug: process.env.FLY_ORG?.trim() || process.env.FLY_WORKER_ORG?.trim() || null,
  };
}

function readFlyAppName(configFile: string): string | null {
  if (!fs.existsSync(configFile)) return null;
  return parseFlyAppName(fs.readFileSync(configFile, "utf8"));
}

async function ensureFlyAuth(): Promise<boolean> {
  if (hasEnvValue(process.env.FLY_API_TOKEN)) return true;
  const result = await command(flyCli(), ["auth", "whoami"]);
  return result.code === 0;
}

async function ensureFlyApp(options: DeployOptions): Promise<void> {
  const args = ["apps", "create", options.appName, "--yes"];
  if (options.orgSlug) args.push("--org", options.orgSlug);
  const result = await command(flyCli(), args);
  if (result.code === 0) return;

  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (
    output.includes("already exists") ||
    output.includes("has already been taken") ||
    output.includes("name unavailable")
  ) {
    console.log(`[fly-worker] app ${options.appName} already exists`);
    return;
  }
  die(trimOutput(result.stderr || result.stdout));
}

async function setFlySecrets(appName: string, secrets: FlySecretPair[]): Promise<void> {
  for (const batch of chunk(secrets, 20)) {
    const args = [
      "secrets",
      "set",
      "--stage",
      ...batch.map((entry) => `${entry.key}=${entry.value}`),
      "-a",
      appName,
    ];
    const result = await command(flyCli(), args);
    if (result.code !== 0) {
      die(trimOutput(result.stderr || result.stdout));
    }
  }
}

async function deployFlyApp(options: DeployOptions): Promise<void> {
  const result = await command(flyCli(), [
    "deploy",
    "--ha=false",
    "--remote-only",
    "--now",
    "-c",
    options.configFile,
    "-a",
    options.appName,
  ]);
  if (result.code !== 0) {
    die(trimOutput(result.stderr || result.stdout));
  }
}

async function scaleFlyAppToOne(appName: string): Promise<void> {
  const result = await command(flyCli(), [
    "scale",
    "count",
    "1",
    "-a",
    appName,
    "--yes",
  ]);
  if (result.code !== 0) {
    die(trimOutput(result.stderr || result.stdout));
  }
}

function resolveSecretValue(
  key: string,
  env: Record<string, string | undefined>,
): string | null {
  const raw = env[key];
  if (!hasEnvValue(raw)) return null;
  const trimmed = raw!.trim();
  if (key === "DATABASE_URL") {
    return normalizePersistentWorkerDatabaseUrl(trimmed);
  }
  if (key === "NATS_CREDS" && fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
    return fs.readFileSync(trimmed, "utf8");
  }
  return trimmed;
}

async function waitForWorkerHealth(
  workerUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const healthUrl = `${workerUrl.replace(/\/$/, "")}/health`;
  let lastFailure = "not attempted";
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    try {
      const response = await fetchImpl(healthUrl, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Fly worker failed its health gate: ${lastFailure}`);
}

function loadDotenvFile(path: string): void {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function flyCli(): string {
  const explicit = process.env.FLY_CLI?.trim();
  if (explicit) return explicit;
  const home = process.env.HOME?.trim();
  if (home && fs.existsSync(`${home}/.fly/bin/flyctl`)) return `${home}/.fly/bin/flyctl`;
  if (home && fs.existsSync(`${home}/.fly/bin/fly`)) return `${home}/.fly/bin/fly`;
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

function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push([...items.slice(index, index + size)]);
  }
  return batches;
}

function hasEnvValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function trimOutput(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(0, 500) || "no output";
}

function die(message: string): never {
  throw new Error(message);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
