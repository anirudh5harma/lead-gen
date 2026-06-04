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

interface ElbTargetHealthCandidate {
  targetGroupArn: string;
  response: ElbTargetHealthResponse;
}

interface CloudWatchFilterLogEventsResponse {
  events?: Array<{ timestamp?: number; message?: string; logStreamName?: string }>;
}

const DEFAULT_CLUSTER = "bombsell-workers";
const DEFAULT_SERVICE = "bombsell-restate-workflows";
const DEFAULT_REGION = "us-east-1";
const DEFAULT_LOOKBACK_MINUTES = 60;
const DEFAULT_LOG_SCAN_LIMIT = 200;
const RESTATE_TROUBLE_RE =
  /(Connection closed|RestateError|WARN: Error|Error when processing|ERR_STREAM_DESTROYED)/;
const HEALTH_TROUBLE_RE =
  /(health check failed|target health checks failed|unhealthy)/i;
const UPPERCASE_ERROR_RE = /\bERROR\b/;

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

  const targetGroupArns = targetGroupArnsFromService(service, env.RESTATE_ECS_TARGET_GROUP_ARN);
  const targetHealthCandidates: ElbTargetHealthCandidate[] = [];
  for (const targetGroupArn of targetGroupArns) {
    const response = await awsJson([
      "elbv2",
      "describe-target-health",
      "--target-group-arn",
      targetGroupArn,
      "--region",
      region,
    ]) as ElbTargetHealthResponse;
    targetHealthCandidates.push({ targetGroupArn, response });
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
      targetHealthCandidates: targetHealthCandidates.length > 0 ? targetHealthCandidates : null,
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
  targetGroupArn?: string;
  targetHealthCandidates?: ElbTargetHealthCandidate[] | null;
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

  const targetHealthCandidates = input.targetHealthCandidates
    ?? (input.targetHealth
      ? [{ targetGroupArn: input.targetGroupArn ?? "target-group", response: input.targetHealth }]
      : null);
  if (!targetHealthCandidates || targetHealthCandidates.length === 0) {
    checks.push({
      name: "elb.target_health",
      status: "warn",
      detail: "target group not discovered; set RESTATE_ECS_TARGET_GROUP_ARN to include it",
    });
  } else {
    const candidates = targetHealthCandidates.map((candidate) =>
      summarizeTargetHealth(candidate),
    );
    const liveCandidates = candidates.filter((candidate) => candidate.active > 0);
    const okCandidate = liveCandidates.find((candidate) =>
      candidate.healthy > 0 && candidate.unhealthy === 0,
    );
    const partiallyHealthyCandidate = liveCandidates.find((candidate) =>
      candidate.healthy > 0,
    );
    checks.push({
      name: "elb.target_health",
      status: okCandidate ? "ok" : partiallyHealthyCandidate ? "warn" : liveCandidates.length > 0 ? "fail" : "warn",
      detail: candidates.map((candidate) =>
        `${targetGroupLabel(candidate.targetGroupArn)} healthy=${candidate.healthy}/${candidate.active} states=${candidate.states.join(",") || "none"}`,
      ).join(" | "),
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
      .filter(isTroublingMessage);
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

function targetGroupArnsFromService(
  service: EcsService | null,
  explicitArn?: string,
): string[] {
  const explicit = explicitArn?.trim();
  if (explicit) return [explicit];
  const loadBalancerArns = service?.loadBalancers
    ?.map((item) => item.targetGroupArn?.trim())
    .filter((item): item is string => Boolean(item)) ?? [];
  return uniqueStrings([
    ...loadBalancerArns,
    ...targetGroupArnsFromEvents(service?.events ?? []),
  ]);
}

function targetGroupArnsFromEvents(events: Array<{ message?: string }>): string[] {
  const targetGroupRe = /(arn:aws:elasticloadbalancing:[^\s)]+)/;
  const registered: string[] = [];
  const other: string[] = [];
  for (const event of events) {
    const match = event.message?.match(targetGroupRe);
    if (!match?.[1]) continue;
    if (event.message?.includes("registered")) registered.push(match[1]);
    else other.push(match[1]);
  }
  return uniqueStrings([...registered, ...other]);
}

function summarizeTargetHealth(candidate: ElbTargetHealthCandidate): {
  targetGroupArn: string;
  states: string[];
  active: number;
  healthy: number;
  unhealthy: number;
} {
  const descriptions = candidate.response.TargetHealthDescriptions ?? [];
  const activeDescriptions = descriptions.filter((item) => {
    const state = item.TargetHealth?.State;
    return state !== "draining" && state !== "unused";
  });
  const states = activeDescriptions.map((item) => item.TargetHealth?.State ?? "unknown");
  const healthy = states.filter((state) => state === "healthy").length;
  return {
    targetGroupArn: candidate.targetGroupArn,
    states,
    active: activeDescriptions.length,
    healthy,
    unhealthy: activeDescriptions.length - healthy,
  };
}

function targetGroupLabel(targetGroupArn: string): string {
  return targetGroupArn.split(":targetgroup/")[1] ?? targetGroupArn;
}

function uniqueStrings(items: string[]): string[] {
  const unique: string[] = [];
  for (const item of items) {
    if (!unique.includes(item)) unique.push(item);
  }
  return unique;
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
    .filter(isTroublingMessage);
}

function isTroublingMessage(message: string): boolean {
  return RESTATE_TROUBLE_RE.test(message) ||
    HEALTH_TROUBLE_RE.test(message) ||
    UPPERCASE_ERROR_RE.test(message);
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
