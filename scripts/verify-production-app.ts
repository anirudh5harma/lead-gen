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
  authCookieHeader?: string | null;
  bearerToken?: string | null;
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
  const authCookieHeader =
    normalizeOptional(opts.authCookieHeader) ?? defaultAuthCookieHeader();
  const bearerToken = normalizeOptional(opts.bearerToken) ?? defaultBearerToken();
  const checks: ProductionAppSmokeCheck[] = [];

  await checkHealth(
    origin,
    { authCookieHeader, bearerToken },
    fetchImpl,
    checks,
  );
  await checkPublicEntry(origin, fetchImpl, checks);
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
  await checkProtectedAuthRoute(origin, "/api/auth/outlook", fetchImpl, checks);
  await checkProtectedAuthRoute(
    origin,
    "/api/auth/microsoft-mail/callback",
    fetchImpl,
    checks,
  );
  await checkProtectedAuthRoute(origin, "/api/auth/linkedin", fetchImpl, checks);
  if (authCookieHeader) {
    await checkAuthenticatedPage(
      origin,
      "/dashboard",
      "Brief",
      authCookieHeader,
      fetchImpl,
      checks,
    );
    await checkAuthenticatedOnboarding(
      origin,
      authCookieHeader,
      fetchImpl,
      checks,
    );
    await checkAuthenticatedPage(
      origin,
      "/dashboard/health",
      "Health",
      authCookieHeader,
      fetchImpl,
      checks,
    );
  }
  if (authCookieHeader || bearerToken) {
    await checkAuthenticatedMcpManifest(
      origin,
      { authCookieHeader, bearerToken },
      fetchImpl,
      checks,
    );
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    origin,
    checks,
  };
}

async function checkAuthenticatedPage(
  origin: string,
  path: string,
  label: string,
  cookieHeader: string,
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: cookieHeader,
      },
    });
  } catch (err) {
    checks.push({
      name: `auth.session${path}`,
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const location = response.headers.get("location") ?? "";
  const actualPath = locationToPath(location, origin);
  checks.push({
    name: `auth.session${path}`,
    status: response.status === 200 ? "ok" : "fail",
    detail:
      response.status === 200
        ? `HTTP 200 ${label} reachable`
        : `HTTP ${response.status} -> ${location || actualPath || "no redirect"}`,
  });
}

async function checkAuthenticatedOnboarding(
  origin: string,
  cookieHeader: string,
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/onboarding`, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        Cookie: cookieHeader,
      },
    });
  } catch (err) {
    checks.push({
      name: "auth.session/onboarding",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const location = response.headers.get("location") ?? "";
  const actualPath = locationToPath(location, origin);
  const redirectOk = [302, 303, 307, 308].includes(response.status);
  checks.push({
    name: "auth.session/onboarding",
    status: redirectOk && actualPath === "/dashboard" ? "ok" : "fail",
    detail:
      response.status === 200
        ? "HTTP 200; completed user still sees onboarding form"
        : `HTTP ${response.status} -> ${location || "missing location"}`,
  });
}

async function checkAuthenticatedMcpManifest(
  origin: string,
  auth: {
    authCookieHeader: string | null;
    bearerToken: string | null;
  },
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth.bearerToken) {
    headers.Authorization = `Bearer ${auth.bearerToken}`;
  } else if (auth.authCookieHeader) {
    headers.Cookie = auth.authCookieHeader;
  }

  let response: Response;
  try {
    response = await fetchImpl(`${origin}/api/mcp`, {
      method: "GET",
      redirect: "manual",
      headers,
    });
  } catch (err) {
    checks.push({
      name: "auth.mcp.manifest",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!response.ok) {
    checks.push({
      name: "auth.mcp.manifest",
      status: "fail",
      detail: `HTTP ${response.status}`,
    });
    return;
  }

  let payload: { workspace_id?: unknown; tools?: unknown };
  try {
    payload = await response.json() as { workspace_id?: unknown; tools?: unknown };
  } catch {
    checks.push({
      name: "auth.mcp.manifest",
      status: "fail",
      detail: "response was not valid JSON",
    });
    return;
  }

  const tools = Array.isArray(payload.tools)
    ? payload.tools.filter((tool): tool is string => typeof tool === "string")
    : [];
  const hasWorkspace = typeof payload.workspace_id === "string" && payload.workspace_id.length > 0;
  const hasBriefTool = tools.includes("bombsell_brief_get");
  checks.push({
    name: "auth.mcp.manifest",
    status: hasWorkspace && hasBriefTool ? "ok" : "fail",
    detail: `workspace=${hasWorkspace ? "present" : "missing"} bombsell_brief_get=${
      hasBriefTool ? "present" : "missing"
    }`,
  });
}

async function checkPublicEntry(
  origin: string,
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/`, {
      method: "GET",
      headers: { Accept: "text/html" },
    });
  } catch (err) {
    checks.push({
      name: "public.entry",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!response.ok) {
    checks.push({
      name: "public.entry",
      status: "fail",
      detail: `HTTP ${response.status}`,
    });
    return;
  }

  const body = await response.text();
  const missing: string[] = [];
  if (!body.includes("/auth/google?next=%2Fdashboard")) {
    missing.push("Google login link");
  }
  if (!body.includes("/auth/google?next=%2Fonboarding")) {
    missing.push("Google onboarding CTA");
  }
  if (!body.includes('action="/auth/start"')) {
    missing.push("domain capture form");
  }

  const stale = [
    'href="/login"',
    "/login?next=",
    'href="/onboarding"',
    'action="/onboarding"',
  ].filter((needle) => body.includes(needle));

  const ok = missing.length === 0 && stale.length === 0;
  checks.push({
    name: "public.entry",
    status: ok ? "ok" : "fail",
    detail: ok
      ? "landing CTAs go through direct Google auth and domain capture"
      : [
          missing.length ? `missing ${missing.join(", ")}` : "",
          stale.length ? `stale ${stale.join(", ")}` : "",
        ].filter(Boolean).join("; "),
  });
}

async function checkHealth(
  origin: string,
  auth: {
    authCookieHeader: string | null;
    bearerToken: string | null;
  },
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
    name: "health.liveness",
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
    name: "health.liveness.service",
    status: payload.service === "bombsell-product" ? "ok" : "fail",
    detail: payload.service ?? "missing service name",
  });

  checks.push({
    name: "health.liveness.ready",
    status: payload.ready === true && payload.status === "ok" ? "ok" : "fail",
    detail: `status=${payload.status ?? "missing"} ready=${String(payload.ready)}`,
  });

  const readinessHeaders: Record<string, string> = { Accept: "application/json" };
  if (auth.authCookieHeader) {
    readinessHeaders.Cookie = auth.authCookieHeader;
  }

  let readinessResponse: Response;
  try {
    readinessResponse = await fetchImpl(`${origin}/api/health/readiness`, {
      headers: readinessHeaders,
    });
  } catch (err) {
    checks.push({
      name: "health.readiness.reachable",
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (!auth.authCookieHeader) {
    checks.push({
      name: "health.readiness.protected",
      status: readinessResponse.status === 401 ? "ok" : "fail",
      detail: `HTTP ${readinessResponse.status}`,
    });
    return;
  }

  const readinessStatusAllowed = readinessResponse.ok || readinessResponse.status === 503;
  checks.push({
    name: "health.readiness.reachable",
    status: readinessStatusAllowed ? "ok" : "fail",
    detail: `HTTP ${readinessResponse.status}`,
  });
  if (!readinessStatusAllowed) return;

  let readinessPayload: ProductHealthPayload;
  try {
    readinessPayload = await readinessResponse.json() as ProductHealthPayload;
  } catch {
    checks.push({
      name: "health.readiness.json",
      status: "fail",
      detail: "response was not valid JSON",
    });
    return;
  }

  const healthChecks = readinessPayload.checks ?? [];
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
    status: readinessPayload.ready === true && readinessPayload.status === "ok" ? "ok" : "fail",
    detail: `status=${readinessPayload.status ?? "missing"} ready=${String(readinessPayload.ready)}`,
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

async function checkProtectedAuthRoute(
  origin: string,
  path: string,
  fetchImpl: typeof fetch,
  checks: ProductionAppSmokeCheck[],
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "text/plain" },
    });
  } catch (err) {
    checks.push({
      name: protectedAuthRouteCheckName(path),
      status: "fail",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const location = response.headers.get("location") ?? "";
  const detail = location
    ? `HTTP ${response.status} -> ${location}`
    : `HTTP ${response.status}`;
  checks.push({
    name: protectedAuthRouteCheckName(path),
    status: response.status === 401 ? "ok" : "fail",
    detail,
  });
}

function protectedAuthRouteCheckName(path: string): string {
  return `auth.${path.replace(/^\/api\/auth\//, "")}.protected`;
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

function normalizeOptional(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function defaultOrigin(): string {
  return process.env.APP_ORIGIN?.trim() || "https://www.bombsell.com";
}

function defaultAuthCookieHeader(): string | null {
  return normalizeOptional(
    process.env.PRODUCTION_APP_COOKIE_HEADER ?? process.env.PRODUCTION_APP_COOKIE,
  );
}

function defaultBearerToken(): string | null {
  return normalizeOptional(process.env.PRODUCTION_APP_BEARER_TOKEN);
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
  if (!defaultAuthCookieHeader() && !defaultBearerToken()) {
    console.log(
      "\nAuthenticated checks skipped. Set PRODUCTION_APP_COOKIE_HEADER from a signed-in browser session or PRODUCTION_APP_BEARER_TOKEN to verify workspace MCP readiness.",
    );
  }
  console.log("\nProduction app smoke passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
