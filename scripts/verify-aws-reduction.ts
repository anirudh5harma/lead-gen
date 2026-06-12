#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

interface AwsIdentity {
  Account?: string;
}

interface AppRunnerListServicesResponse {
  ServiceSummaryList?: Array<{ ServiceName?: string; Status?: string }>;
}

interface BudgetSummary {
  BudgetName?: string;
  BudgetLimit?: { Amount?: string; Unit?: string };
  BudgetType?: string;
  TimeUnit?: string;
  CostFilters?: Record<string, string[] | undefined>;
}

interface BudgetsResponse {
  Budgets?: BudgetSummary[];
}

interface EcrLifecyclePolicyResponse {
  lifecyclePolicyText?: string;
}

const REQUIRED_BUDGETS = [
  "Bombsell AWS Monthly Cost Cap",
  "Bombsell AWS Worker Infrastructure Cap",
];

const FORBIDDEN_VERCEL_ENV = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SES_REQUIRED",
  "MANAGED_OWNED_DOMAIN_EMAIL_ENABLED",
];

const checks: Check[] = [];

function record(name: string, status: CheckStatus, detail: string): void {
  checks.push({ name, status, detail });
  console.log(`  ${status.toUpperCase().padEnd(4, " ")} ${name} - ${detail}`);
}

async function main(): Promise<void> {
  console.log("AWS reduction readiness checks");

  const identity = await checkAwsIdentity();
  await checkAppRunner();
  await checkBudgets(identity?.Account);
  await checkEcrLifecycle();
  await checkVercelEnv();
  await checkRestateReadiness();
  await checkCurrentEcsHealth();

  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  if (failed.length > 0) {
    console.error(`\n${failed.length} AWS reduction readiness check(s) failed.`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(`\nAWS reduction readiness passed with ${warnings.length} warning(s).`);
    return;
  }
  console.log("\nAWS reduction readiness verified.");
}

async function checkAwsIdentity(): Promise<AwsIdentity | null> {
  try {
    const identity = await awsJson<AwsIdentity>(["sts", "get-caller-identity"]);
    record(
      "aws.identity",
      identity.Account ? "ok" : "fail",
      identity.Account ? `account ${identity.Account}` : "AWS account was not returned",
    );
    return identity;
  } catch (error) {
    record("aws.identity", "fail", detailFromError(error));
    return null;
  }
}

async function checkAppRunner(): Promise<void> {
  try {
    const payload = await awsJson<AppRunnerListServicesResponse>([
      "apprunner",
      "list-services",
      "--region",
      awsRegion(),
    ]);
    const services = payload.ServiceSummaryList ?? [];
    record(
      "aws.apprunner.empty",
      services.length === 0 ? "ok" : "fail",
      services.length === 0
        ? "no App Runner services remain in us-east-1"
        : services.map((service) => `${service.ServiceName ?? "unknown"}:${service.Status ?? "unknown"}`).join(", "),
    );
  } catch (error) {
    record("aws.apprunner.empty", "fail", detailFromError(error));
  }
}

async function checkBudgets(accountId: string | undefined): Promise<void> {
  if (!accountId) {
    record("aws.budgets", "fail", "AWS account id is required to list budgets");
    return;
  }
  try {
    const payload = await awsJson<BudgetsResponse>([
      "budgets",
      "describe-budgets",
      "--account-id",
      accountId,
    ]);
    const budgets = payload.Budgets ?? [];
    const names = new Set(budgets.map((budget) => budget.BudgetName).filter(Boolean));
    const missing = REQUIRED_BUDGETS.filter((budgetName) => !names.has(budgetName));
    record(
      "aws.budgets.present",
      missing.length === 0 ? "ok" : "fail",
      missing.length === 0
        ? REQUIRED_BUDGETS.map((budgetName) => {
          const budget = budgets.find((item) => item.BudgetName === budgetName);
          return `${budgetName}=${budget?.BudgetLimit?.Amount ?? "unknown"} ${budget?.BudgetLimit?.Unit ?? ""}`.trim();
        }).join("; ")
        : `missing ${missing.join(", ")}`,
    );
  } catch (error) {
    record("aws.budgets.present", "fail", detailFromError(error));
  }
}

async function checkEcrLifecycle(): Promise<void> {
  try {
    const payload = await awsJson<EcrLifecyclePolicyResponse>([
      "ecr",
      "get-lifecycle-policy",
      "--repository-name",
      "bombsell-worker",
      "--region",
      awsRegion(),
    ]);
    const parsed = JSON.parse(payload.lifecyclePolicyText ?? "{}") as {
      rules?: Array<{
        selection?: { tagStatus?: string; countNumber?: number };
      }>;
    };
    const rules = parsed.rules ?? [];
    const hasUntaggedExpiry = rules.some((rule) =>
      rule.selection?.tagStatus === "untagged" && rule.selection.countNumber === 7
    );
    const hasTaggedRetention = rules.some((rule) =>
      rule.selection?.tagStatus === "tagged" && rule.selection.countNumber === 10
    );
    record(
      "aws.ecr.lifecycle",
      hasUntaggedExpiry && hasTaggedRetention ? "ok" : "fail",
      hasUntaggedExpiry && hasTaggedRetention
        ? "untagged artifacts expire after 7 days; 10 tagged rollback images retained"
        : "expected untagged expiry and tagged rollback retention rules were not found",
    );
  } catch (error) {
    record("aws.ecr.lifecycle", "fail", detailFromError(error));
  }
}

async function checkVercelEnv(): Promise<void> {
  try {
    const result = await command("npx", ["vercel", "env", "ls"]);
    if (result.code !== 0) {
      record("vercel.env.aws_keys_absent", "fail", trimOutput(result.stderr || result.stdout));
      return;
    }
    const present = FORBIDDEN_VERCEL_ENV.filter((key) =>
      new RegExp(`(^|\\s)${escapeRegExp(key)}(\\s|$)`).test(result.stdout)
    );
    record(
      "vercel.env.aws_keys_absent",
      present.length === 0 ? "ok" : "fail",
      present.length === 0
        ? "static AWS keys and managed-domain opt-in flags are absent"
        : `unexpected env vars present: ${present.join(", ")}`,
    );
  } catch (error) {
    record("vercel.env.aws_keys_absent", "fail", detailFromError(error));
  }
}

async function checkRestateReadiness(): Promise<void> {
  const env = loadSelectedLocalEnv([
    "RESTATE_INGRESS_URL",
    "RESTATE_BEARER_TOKEN",
    "RESTATE_AUTH_TOKEN",
  ]);
  const result = await command("npm", ["run", "verify:restate"], {
    ...process.env,
    ...env,
    RESTATE_BEARER_TOKEN: env.RESTATE_BEARER_TOKEN ?? env.RESTATE_AUTH_TOKEN ?? process.env.RESTATE_BEARER_TOKEN,
    RESTATE_AUTH_TOKEN: env.RESTATE_AUTH_TOKEN ?? env.RESTATE_BEARER_TOKEN ?? process.env.RESTATE_AUTH_TOKEN,
  });
  record(
    "restate.workflow_contract",
    result.code === 0 ? "ok" : "fail",
    result.code === 0
      ? "registered deployment advertises the full required workflow set"
      : trimOutput(result.stdout || result.stderr),
  );
}

async function checkCurrentEcsHealth(): Promise<void> {
  const result = await command("npm", ["run", "verify:restate-ecs-health"], {
    ...process.env,
    RESTATE_ECS_LOG_LOOKBACK_MINUTES: process.env.RESTATE_ECS_LOG_LOOKBACK_MINUTES ?? "3",
  });
  record(
    "aws.ecs.current_worker",
    result.code === 0 ? "ok" : "fail",
    result.code === 0
      ? "current ECS worker is intentionally active and healthy until provider cutover"
      : trimOutput(result.stdout || result.stderr),
  );
}

function awsRegion(): string {
  return process.env.AWS_REGION?.trim() || "us-east-1";
}

async function awsJson<T>(args: string[]): Promise<T> {
  const result = await command("aws", [...args, "--output", "json"]);
  if (result.code !== 0) throw new Error(trimOutput(result.stderr || result.stdout));
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    throw new Error(`AWS command did not return JSON: ${trimOutput(result.stdout)}`);
  }
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

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
