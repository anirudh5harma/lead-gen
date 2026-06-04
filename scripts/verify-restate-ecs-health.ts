import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

type CheckStatus = "ok" | "warn" | "fail";

export interface RestateEcsHealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface RestateEcsHealthResult {
  ok: boolean;
  region: string;
  cluster: string;
  service: string;
  checks: RestateEcsHealthCheck[];
}

export interface RestateEcsHealthProbeOptions {
  env?: Record<string, string | undefined>;
  now?: () => number;
  awsJson?: AwsJsonRunner;
}

export type AwsJsonRunner = (args: string[]) => Promise<unknown>;

interface EcsService {
  serviceName?: string;
  status?: string;
  desiredCount?: number;
  runningCount?: number;
  pendingCount?: number;
  taskDefinition?: string;
  loadBalancers?: Array<{ targetGroupArn?: string }>;
  deployments?: Array<{
    status?: string;
    taskDefinition?: string;
    rolloutState?: string;
    rolloutStateReason?: string;
    desiredCount?: number;
    runningCount?: number;
    pendingCount?: number;
  }>;
  events?: Array<{ message?: string; createdAt?: string | number }>;
}

interface EcsDescribeServicesResponse {
  services?: EcsService[];
  failures?: Array<{ arn?: string; reason?: string; detail?: string }>;
}

interface EcsTaskDefinitionResponse {
  taskDefinition?: {
    containerDefinitions?: Array<{
      name?: string;
      logConfiguration?: {
        logDriver?: string;
        options?: Record<string, string | undefined>;
      };
    }>;
  };
}

interface ElbTargetHealthResponse {
  TargetHealthDescriptions?: Array<{
    Target?: { Id?: string; Port?: number };
    TargetHealth?: { State?: string; Reason?: string; Description?: string };
  }>;
}

interface CloudWatchFilterLogEventsResponse {
  events?: Array<{ timestamp?: number; message?: string; logStreamName?: string }>;
}

const DEFAULT_CLUSTER = "bombsell-workers";
const DEFAULT_SERVICE = "bombsell-restate-workflows";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_LOOKBACK_MINUTES = 60;
const DEFAULT_LOG_SCAN_LIMIT = 200;
const TROUBLE_RE =
  /(Connection closed|RestateError|WARN: Error|ERROR|Error when processing|ERR_STREAM_DESTROYED|health check failed|target health checks failed|unhealthy)/i;

export async function runRestateEcsHealthProbe(
  opts: RestateEcsHealthProbeOptions = {},
): Promise<RestateEcsHealthResult> {
  const env = opts.env ?? process.env;
  const region = env.AWS_REGION?.trim() || DEFAULT_REGION;
  const cluster = env.RESTATE_ECS_CLUSTER?.trim() || DEFAULT_CLUSTER;
  const serviceName = env.RESTATE_ECS_SERVICE?.trim() || DEFAULT_SERVICE;
  const now = opts.now ?? Date.now;
  const awsJson = opts.awsJson ?? awsCliJson;
  const checks: RestateEcsHealthCheck[] = [];

  const serviceResponse = await awsJson([
    "ecs",
    "describe-services",
    "--cluster",
    cluster,
    "--services",
    serviceName,
    "--region",
    region,
  ]) as EcsDescribeServicesResponse;
  const service = serviceResponse.services?.[0] ?? null;
  const failures = serviceResponse.failures ?? [];
  if (failures.length > 0) {
    checks.push({
      name: "ecs.service.lookup",
      status: "fail",
      detail: failures.map((failure) => failure.reason ?? failure.detail ?? failure.arn ?? "unknown").join(", "),
    });
  }

  const taskDefinitionArn = taskDefinitionFromService(service);
  let taskDefinition: EcsTaskDefinitionResponse | null = null;
  if (taskDefinitionArn) {
    taskDefinition = await awsJson([
      "ecs",
      "describe-task-definition",
      "--task-definition",
      taskDefinitionArn,
      "--region",
      region,
    ]) as EcsTaskDefinitionResponse;
  }

  const targetGroupArn =
    env.RESTATE_ECS_TARGET_GROUP_ARN?.trim() ||
    service?.loadBalancers?.find((item) => item.targetGroupArn)?.targetGroupArn ||
    targetGroupArnFromEvents(service?.events ?? []) ||
    "";
  let targetHealth: ElbTargetHealthResponse | null = null;
  if (targetGroupArn) {
    targetHealth = await awsJson([
      "elbv2",
      "describe-target-health",
      "--target-group-arn",
      targetGroupArn,
      "--region",
      region,
    ]) as ElbTargetHealthResponse;
  }

  const logGroup =
    env.RESTATE_ECS_LOG_GROUP?.trim() ||
    logGroupFromTaskDefinition(taskDefinition, env.RESTATE_ECS_CONTAINER_NAME?.trim()) ||
    "";
  let logEvents: CloudWatchFilterLogEventsResponse | null = null;
  if (logGroup) {
    const lookbackMinutes = boundedNumber(
      env.RESTATE_ECS_LOG_LOOKBACK_MINUTES,
      DEFAULT_LOOKBACK_MINUTES,
      1,
      24 * 60,
    );
    const limit = boundedNumber(
      env.RESTATE_ECS_LOG_SCAN_LIMIT,
      DEFAULT_LOG_SCAN_LIMIT,
      1,
      10_000,
    );
    logEvents = await awsJson([
      "logs",
      "filter-log-events",
      "--log-group-name",
      logGroup,
      "--start-time",
      String(now() - lookbackMinutes * 60_000),
      "--limit",
      String(limit),
      "--region",
      region,
    ]) as CloudWatchFilterLogEventsResponse;
  }

  checks.push(
    ...assessRestateEcsHealth({
      service,
      targetHealth,
      logEvents,
      logGroup,
      now,
      lookbackMinutes: boundedNumber(
        env.RESTATE_ECS_LOG_LOOKBACK_MINUTES,
        DEFAULT_LOOKBACK_MINUTES,
        1,
        24 * 60,
      ),
    }),
  );

  return {
    ok: checks.every((check) => check.status !== "fail"),
    region,
    cluster,
    service: serviceName,
    checks,
  };
}

export function assessRestateEcsHealth(input: {
  service: EcsService | null;
  targetHealth?: ElbTargetHealthResponse | null;
  logEvents?: CloudWatchFilterLogEventsResponse | null;
  logGroup?: string;
  now?: () => number;
  lookbackMinutes?: number;
}): RestateEcsHealthCheck[] {
  const checks: RestateEcsHealthCheck[] = [];
  const now = input.now ?? Date.now;
  const lookbackMinutes = input.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
  const service = input.service;

  if (!service) {
    checks.push({
      name: "ecs.service.present",
      status: "fail",
      detail: "ECS service was not returned",
    });
    return checks;
  }

  checks.push({
    name: "ecs.service.status",
    status: service.status === "ACTIVE" ? "ok" : "fail",
    detail: service.status ?? "missing",
  });

  const desired = service.desiredCount ?? 0;
  const running = service.runningCount ?? 0;
  const pending = service.pendingCount ?? 0;
  checks.push({
    name: "ecs.service.steady",
    status: desired > 0 && running >= desired && pending === 0 ? "ok" : "fail",
    detail: `desired=${desired} running=${running} pending=${pending}`,
  });

  const deployments = service.deployments ?? [];
  const failedDeployment = deployments.find((item) => item.rolloutState === "FAILED");
  const primary = deployments.find((item) => item.status === "PRIMARY");
  checks.push({
    name: "ecs.deployment.rollout",
    status: failedDeployment ? "fail" : primary?.rolloutState === "COMPLETED" ? "ok" : "warn",
    detail: failedDeployment
      ? failedDeployment.rolloutStateReason ?? "deployment rollout failed"
      : primary
        ? `primary=${primary.rolloutState ?? "unknown"} desired=${primary.desiredCount ?? 0} running=${primary.runningCount ?? 0}`
        : "primary deployment not found",
  });

  const serviceTrouble = recentTroubleMessages(service.events ?? [], now(), lookbackMinutes);
  checks.push({
    name: "ecs.service.events",
    status: serviceTrouble.length > 0 ? "fail" : "ok",
    detail: serviceTrouble.length > 0
      ? `${serviceTrouble.length} recent troubling service event(s): ${serviceTrouble.slice(0, 2).join(" | ")}`
      : `no target-health or replacement events in ${lookbackMinutes}m`,
  });

  const targetDescriptions = input.targetHealth?.TargetHealthDescriptions;
  if (!targetDescriptions) {
    checks.push({
      name: "elb.target_health",
      status: "warn",
      detail: "target group not discovered; set RESTATE_ECS_TARGET_GROUP_ARN to include it",
    });
  } else {
    const states = targetDescriptions.map((item) => item.TargetHealth?.State ?? "unknown");
    const healthy = states.filter((state) => state === "healthy").length;
    const unhealthy = targetDescriptions.filter((item) => item.TargetHealth?.State !== "healthy");
    checks.push({
      name: "elb.target_health",
      status: healthy > 0 ? unhealthy.length > 0 ? "warn" : "ok" : "fail",
      detail: `healthy=${healthy}/${states.length} states=${states.join(",") || "none"}`,
    });
  }

  if (!input.logEvents) {
    checks.push({
      name: "logs.restate_errors",
      status: "warn",
      detail: input.logGroup
        ? "CloudWatch log events were not returned"
        : "log group not discovered; set RESTATE_ECS_LOG_GROUP to include log scanning",
    });
  } else {
    const matches = (input.logEvents.events ?? [])
      .map((event) => event.message?.trim() ?? "")
      .filter((message) => TROUBLE_RE.test(message));
    checks.push({
      name: "logs.restate_errors",
      status: matches.length > 0 ? "fail" : "ok",
      detail: matches.length > 0
        ? `${matches.length} troubling log event(s): ${matches.slice(0, 2).join(" | ")}`
        : `no Restate stream/health errors in scanned ${lookbackMinutes}m logs`,
    });
  }

  return checks;
}

function logGroupFromTaskDefinition(
  response: EcsTaskDefinitionResponse | null,
  preferredContainerName?: string,
): string | null {
  const containers = response?.taskDefinition?.containerDefinitions ?? [];
  const ordered = preferredContainerName
    ? [
        ...containers.filter((container) => container.name === preferredContainerName),
        ...containers.filter((container) => container.name !== preferredContainerName),
      ]
    : containers;
  for (const container of ordered) {
    const group = container.logConfiguration?.options?.["awslogs-group"]?.trim();
    if (group) return group;
  }
  return null;
}

function taskDefinitionFromService(service: EcsService | null): string | null {
  if (service?.taskDefinition) return service.taskDefinition;
  const deployments = service?.deployments ?? [];
  return deployments.find((item) => item.status === "PRIMARY")?.taskDefinition
    ?? deployments.find((item) => item.taskDefinition)?.taskDefinition
    ?? null;
}

function targetGroupArnFromEvents(events: Array<{ message?: string }>): string | null {
  const targetGroupRe = /(arn:aws:elasticloadbalancing:[^\s)]+)/;
  for (const event of events) {
    const match = event.message?.match(targetGroupRe);
    if (match?.[1]) return match[1];
  }
  return null;
}

function recentTroubleMessages(
  events: Array<{ message?: string; createdAt?: string | number }>,
  nowMs: number,
  lookbackMinutes: number,
): string[] {
  const cutoff = nowMs - lookbackMinutes * 60_000;
  return events
    .filter((event) => {
      const created = event.createdAt ? new Date(event.createdAt).getTime() : nowMs;
      return Number.isFinite(created) && created >= cutoff;
    })
    .map((event) => event.message?.trim() ?? "")
    .filter((message) => TROUBLE_RE.test(message));
}

function boundedNumber(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

async function awsCliJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFilePromise("aws", [...args, "--output", "json"]);
  return JSON.parse(stdout || "{}") as unknown;
}

function execFilePromise(
  file: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr.trim() || err.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function main(): Promise<void> {
  const result = await runRestateEcsHealthProbe();
  console.log(
    `Restate ECS health: cluster=${result.cluster} service=${result.service} region=${result.region}`,
  );
  for (const check of result.checks) {
    const label =
      check.status === "ok" ? "OK  " : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`  ${label} ${check.name} - ${check.detail}`);
  }
  if (!result.ok) {
    console.error("\nRestate ECS health check failed.");
    process.exit(1);
  }
  console.log("\nRestate ECS health verified.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
