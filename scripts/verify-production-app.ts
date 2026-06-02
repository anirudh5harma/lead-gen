import { pathToFileURL } from "node:url";

type CheckStatus = "ok" | "warn" | "fail";

export interface ProductionAppSmokeCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface ProductionAppSmokeResult {
  ok: boolean;
  origin: string;
  checks: ProductionAppSmokeCheck[];
}

interface ProductHealthPayload {
  service?: string;
  status?: string;
  ready?: boolean;
  checks?: Array<{
    name?: string;
    status?: string;
    detail?: string;
  }>;
}

interface ProductionAppSmokeOptions {
  origin?: string;
  fetchImpl?: typeof fetch;
}

const REQUIRED_HEALTH_CHECKS = [
  "environment",
  "nats.credentials",
  "restate.ingress",
  "substrate",
  "database",
  "schema.tables",
  "schema.migrations",
];

export async function runProductionAppSmoke(
  opts: ProductionAppSmokeOptions = {},
): Promise<ProductionAppSmokeResult> {
  const origin = normalizeOrigin(opts.origin ?? defaultOrigin());
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const checks: ProductionAppSmokeCheck[] = [];

  await checkHealth(origin, fetchImpl, checks);
  await checkRedirect(
    origin,
    "/dashboard",
    "/auth/google?next=%2Fdashboard",
    fetchImpl,
    checks,
  );
  await checkRedirect(
    origin,
    "/onboarding",
    "/auth/google?next=%2Fonboarding",
    fetchImpl,
    checks,
  );

  return {
    ok: checks.every((check) => check.status !== "fail"),
    origin,
    checks,
  };
}

async function checkHealth(
  origin: string,
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/api/health`, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    checks.push({
      name: "health.reachable",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const healthStatusAllowed = response.ok || response.status === 503;
  checks.push({
    name: "health.reachable",
    status: healthStatusAllowed ? "ok" : "fail",
    detail: `HTTP ${response.status}`,
  });
  if (!healthStatusAllowed) return;

  let payload: ProductHealthPayload;
  try {
    payload = await response.json() as ProductHealthPayload;
  } catch {
    checks.push({
      name: "health.json",
      status: "fail",
      detail: "response was not valid JSON",
    });
    return;
  }

  checks.push({
    name: "health.service",
    status: payload.service === "bombsell-product" ? "ok" : "fail",
    detail: payload.service ?? "missing service name",
  });

  const healthChecks = payload.checks ?? [];
  for (const required of REQUIRED_HEALTH_CHECKS) {
    const item = healthChecks.find((check) => check.name === required);
    checks.push({
      name: `health.${required}`,
      status: item?.status === "ok" ? "ok" : "fail",
      detail: item?.detail ?? item?.status ?? "missing",
    });
  }

  const degraded = healthChecks.filter((check) => check.status !== "ok");
  const unexpected = degraded.filter((check) => check.name !== "linkedin.provider");
  if (unexpected.length > 0) {
    checks.push({
      name: "health.degraded",
      status: "fail",
      detail: unexpected
        .map((check) => `${check.name ?? "unknown"}=${check.status ?? "unknown"}`)
        .join(", "),
    });
    return;
  }

  const linkedin = degraded.find((check) => check.name === "linkedin.provider");
  if (linkedin) {
    checks.push({
      name: "health.linkedin.provider",
      status: "warn",
      detail: linkedin.detail ?? "LinkedIn provider is not production-ready",
    });
    return;
  }

  checks.push({
    name: "health.ready",
    status: payload.ready === true && payload.status === "ok" ? "ok" : "fail",
    detail: `status=${payload.status ?? "missing"} ready=${String(payload.ready)}`,
  });
}

async function checkRedirect(
  origin: string,
  path: string,
  expectedPath: string,
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method: "HEAD",
      redirect: "manual",
    });
  } catch (err) {
    checks.push({
      name: `auth${path}`,
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const location = response.headers.get("location") ?? "";
  const actualPath = locationToPath(location, origin);
  const redirectOk = [302, 303, 307, 308].includes(response.status);
  checks.push({
    name: `auth${path}`,
    status: redirectOk && actualPath === expectedPath ? "ok" : "fail",
    detail: `HTTP ${response.status} -> ${location || "missing location"}`,
  });
}

function locationToPath(location: string, origin: string): string {
  if (!location) return "";
  try {
    const parsed = new URL(location, origin);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return location;
  }
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function defaultOrigin(): string {
  return process.env.APP_ORIGIN?.trim() || "https://www.bombsell.com";
}

async function main(): Promise<void> {
  const origin = process.argv[2]?.trim() || defaultOrigin();
  console.log(`Production app smoke: ${normalizeOrigin(origin)}`);
  const result = await runProductionAppSmoke({ origin });
  for (const check of result.checks) {
    const label =
      check.status === "ok" ? "OK  " : check.status === "warn" ? "WARN" : "FAIL";
    console.log(`  ${label} ${check.name} - ${check.detail}`);
  }
  if (!result.ok) {
    console.error("\nProduction app smoke failed.");
    process.exit(1);
  }
  console.log("\nProduction app smoke passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
