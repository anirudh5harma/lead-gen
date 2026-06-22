import type { Pool } from "pg";
import { connect, credsAuthenticator } from "nats";
import { tryGetPool } from "../substrate/storage/index.ts";
import { checkProductEnvironment } from "./env.ts";
import { resolveProductSubstrateMode } from "./substrate.ts";

export type ProductReadinessStatus = "ok" | "degraded" | "unconfigured";

export interface ProductReadinessCheck {
  name: string;
  status: ProductReadinessStatus;
  detail?: string;
}

export interface ProductReadiness {
  service: "bombsell-product";
  status: ProductReadinessStatus;
  ready: boolean;
  checked_at: string;
  checks: ProductReadinessCheck[];
}

interface ProductReadinessDeps {
  probeNatsConnection?: (env: Record<string, string | undefined>) => Promise<void>;
  probeRestateIngress?: (env: Record<string, string | undefined>) => Promise<void>;
  probeRestateServices?: (env: Record<string, string | undefined>) => Promise<void>;
  probeLinkedInProvider?: (env: Record<string, string | undefined>) => Promise<void>;
}

export interface CachedProductReadinessOptions {
  pool?: Pool | null;
  env?: Record<string, string | undefined>;
  deps?: ProductReadinessDeps;
  forceRefresh?: boolean;
  liveProbes?: boolean;
  ttlMs?: number;
  nowMs?: () => number;
}

interface RestateDeployment {
  id?: string;
  uri?: string;
  endpoint?: string;
  address?: string;
  services?: Array<{ name?: string }>;
}

interface RestateDeploymentsResponse {
  deployments?: RestateDeployment[];
}

export interface RestateDeploymentSummary {
  deployments: Array<{
    id: string | null;
    uri: string | null;
    services: string[];
    missingRequiredServices: string[];
  }>;
  services: string[];
  missing: string[];
  incompleteRequiredDeployments: Array<{
    id: string | null;
    uri: string | null;
    services: string[];
    missingRequiredServices: string[];
  }>;
}

const REQUIRED_TABLES = [
  "workspaces",
  "workspace_members",
  "events",
  "workflow_runs",
  "workflow_steps",
  "workflow_checkpoints",
  "workflow_approvals",
  "graph_sources",
  "graph_edges",
  "signals",
  "conversations",
  "messages",
  "reps",
  "plays",
  "play_runs",
  "outcomes",
  "channel_accounts",
  "sending_domains",
  "workspace_llm_usage",
  "event_projection_jobs",
  "rep_memory_procedural_applications",
];

const REQUIRED_MIGRATIONS = [
  "021_event_idempotency_keys.sql",
  "027_signal_novelty_uniqueness.sql",
  "028_workspace_llm_usage.sql",
  "029_workflow_run_leases.sql",
  "030_event_projection_jobs.sql",
  "031_procedural_memory_applications.sql",
];

const READINESS_CACHE_TTL_MS = 15_000;
const READINESS_EXTERNAL_PROBE_TIMEOUT_MS = 2_500;

interface ProductReadinessCacheEntry {
  value?: ProductReadiness;
  expiresAt: number;
  inFlight?: Promise<ProductReadiness>;
}

const productReadinessCache = new Map<string, ProductReadinessCacheEntry>();
const CONFIG_ONLY_READINESS_DEPS: ProductReadinessDeps = {
  probeNatsConnection: async () => undefined,
  probeRestateIngress: async () => undefined,
  probeRestateServices: async () => undefined,
  probeLinkedInProvider: async () => undefined,
};

export const REQUIRED_RESTATE_SERVICES = [
  "system.restate_runtime_probe.v1",
  "workspace.activation.setup",
  "workspace.profile.icp",
  "workspace.campaign.strategy",
  "workspace.channel.readiness",
  "workspace.company_brain.brief",
  "workspace.company_brain.recall",
  "workspace.contact.waterfall",
  "workspace.eval.gate",
  "workspace.meeting.prep",
  "workspace.message.personalization",
  "workspace.outreach.skill_selection",
  "workspace.reply.triage",
  "workspace.signal.ingestion",
  "workspace.skill.optimizer",
  "workspace.source.discovery",
  "workspace.vertical_intelligence.refresh",
  "workspace.signal.matching",
  "series_a_cold_open",
  "play.signal_to_email.v1",
  "play.signal_to_linkedin.v1",
  "play.reply_to_email.v1",
  "contact.resolve_for_signal.v1",
  "ingest_catalog_poll",
  "ingest_shared_x_poll",
  "ingest_workspace_poll",
  "ingest_expire_sweep",
  "channel.email_domain_provision.v1",
  "channel.email_domain_warmup.v1",
  "email_domain_warmup_sweep",
  "email_outlook_subscription_repair",
  "profile.bootstrap.exa",
  "rep.brief.refresh.exa",
  "rep.research.exa",
  "draft.grounding.exa",
  "content.opportunity.exa",
  "aeo.audit.exa",
  "signal.discover.open_web.exa",
] as const;

export async function checkProductReadinessCached(
  opts: CachedProductReadinessOptions = {},
): Promise<ProductReadiness> {
  const pool = opts.pool === undefined ? tryGetPool() : opts.pool;
  const env = opts.env ?? process.env;
  const deps = opts.deps ?? (opts.liveProbes ? {} : CONFIG_ONLY_READINESS_DEPS);
  const key = productReadinessCacheKey(pool, env, {
    liveProbes: opts.liveProbes === true,
    customDeps: Boolean(opts.deps),
  });
  const now = opts.nowMs?.() ?? Date.now();
  const ttlMs = opts.ttlMs ?? READINESS_CACHE_TTL_MS;
  const cached = productReadinessCache.get(key);

  if (!opts.forceRefresh && cached?.value && now < cached.expiresAt) {
    return cached.value;
  }
  if (!opts.forceRefresh && cached?.inFlight) {
    return cached.inFlight;
  }

  const inFlight = checkProductReadiness(pool, env, deps)
    .then((value) => {
      const current = productReadinessCache.get(key);
      if (ttlMs > 0 && current?.inFlight === inFlight) {
        productReadinessCache.set(key, {
          value,
          expiresAt: Date.now() + ttlMs,
        });
      } else if (ttlMs <= 0 && current?.inFlight === inFlight) {
        productReadinessCache.delete(key);
      }
      return value;
    })
    .finally(() => {
      const current = productReadinessCache.get(key);
      if (current?.inFlight === inFlight) productReadinessCache.delete(key);
    });

  productReadinessCache.set(key, {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
  });
  return inFlight;
}

export function resetProductReadinessCacheForTests(): void {
  productReadinessCache.clear();
}

export async function checkProductReadiness(
  pool: Pool | null = tryGetPool(),
  env: Record<string, string | undefined> = process.env,
  deps: ProductReadinessDeps = {},
): Promise<ProductReadiness> {
  const checks: ProductReadinessCheck[] = [];
  if (!pool) {
    checks.push({
      name: "database",
      status: "unconfigured",
      detail: "DATABASE_URL is not configured",
    });
    const [environment, linkedInProvider] = await Promise.all([
      Promise.resolve(formatEnvironmentCheck(env)),
      formatLinkedInProviderCheck(env, deps),
    ]);
    checks.push(environment);
    checks.push(linkedInProvider);
    return formatReadiness(checks);
  }

  try {
    const substrate = resolveProductSubstrateMode(env.BOMBSELL_SUBSTRATE);
    const [
      environment,
      linkedInProvider,
      natsCredentials,
      restateIngress,
      substrateCheck,
    ] = await Promise.all([
      Promise.resolve(formatEnvironmentCheck(env)),
      formatLinkedInProviderCheck(env, deps),
      formatNatsCredentialCheck(env, deps),
      formatRestateIngressCheck(env, deps),
      Promise.resolve(formatSubstrateCheck(substrate, env)),
    ]);
    checks.push(environment);
    checks.push(linkedInProvider);
    checks.push(natsCredentials);
    checks.push(restateIngress);
    checks.push(substrateCheck);

    await pool.query("select 1");
    checks.push({ name: "database", status: "ok" });

    const [missingTables, missingMigrations] = await Promise.all([
      missingRequiredTables(pool),
      missingRequiredMigrations(pool),
    ]);
    checks.push(
      missingTables.length === 0
        ? { name: "schema.tables", status: "ok" }
        : {
            name: "schema.tables",
            status: "degraded",
            detail: `Missing tables: ${missingTables.join(", ")}`,
          },
    );

    checks.push(
      missingMigrations.length === 0
        ? { name: "schema.migrations", status: "ok" }
        : {
            name: "schema.migrations",
            status: "degraded",
            detail: `Missing migrations: ${missingMigrations.join(", ")}`,
          },
    );
  } catch (err) {
    checks.push({
      name: "readiness",
      status: "degraded",
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  return formatReadiness(checks);
}

function formatEnvironmentCheck(
  env: Record<string, string | undefined>,
): ProductReadinessCheck {
  const report = checkProductEnvironment(env);
  if (report.status === "ok") {
    return {
      name: "environment",
      status: "ok",
      detail:
        env.NODE_ENV === "production"
          ? `Configured production keys: ${report.configuredProductionKeys.join(", ")}`
          : "Production key enforcement is active when NODE_ENV=production",
    };
  }
  return {
    name: "environment",
    status: "degraded",
    detail: `Missing production env keys: ${report.missingProductionKeys.join(", ")}`,
  };
}

export function formatLinkedInProviderCheck(
  env: Record<string, string | undefined>,
  deps: ProductReadinessDeps = {},
): Promise<ProductReadinessCheck> {
  return formatLinkedInProviderCheckInternal(env, deps);
}

async function formatLinkedInProviderCheckInternal(
  env: Record<string, string | undefined>,
  deps: ProductReadinessDeps,
): Promise<ProductReadinessCheck> {
  if (env.NODE_ENV !== "production") {
    return {
      name: "linkedin.provider",
      status: "ok",
      detail: "Production LinkedIn provider validation is active when NODE_ENV=production",
    };
  }

  const missing = [
    "LINKEDIN_PROVIDER_URL",
    "LINKEDIN_PROVIDER_HEALTH_URL",
    "LINKEDIN_PROVIDER_API_KEY",
    "LINKEDIN_PROVIDER_WEBHOOK_SECRET",
  ].filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    return {
      name: "linkedin.provider",
      status: "degraded",
      detail: `Missing LinkedIn provider env keys: ${missing.join(", ")}`,
    };
  }

  for (const key of [
    "LINKEDIN_PROVIDER_URL",
    "LINKEDIN_PROVIDER_AUTH_URL",
    "LINKEDIN_PROVIDER_HEALTH_URL",
  ] as const) {
    const raw = env[key]?.trim();
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") throw new Error("not https");
    } catch {
      return {
        name: "linkedin.provider",
        status: "degraded",
        detail: `${key} must be a valid HTTPS URL`,
      };
    }
  }

  const redirect = env.LINKEDIN_REDIRECT_URI?.trim();
  if (redirect) {
    try {
      const url = new URL(redirect);
      if (url.protocol !== "https:") throw new Error("not https");
    } catch {
      return {
        name: "linkedin.provider",
        status: "degraded",
        detail: "LINKEDIN_REDIRECT_URI must be a valid HTTPS URL when set in production",
      };
    }
  }

  try {
    await (deps.probeLinkedInProvider ?? probeLinkedInProvider)(env);
  } catch (err) {
    return {
      name: "linkedin.provider",
      status: "degraded",
      detail: `LinkedIn provider health check failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  return {
    name: "linkedin.provider",
    status: "ok",
    detail: env.LINKEDIN_PROVIDER_AUTH_URL?.trim()
      ? "LinkedIn provider send, auth, and webhook ingress are configured"
      : "LinkedIn provider send and webhook ingress are configured; auth URL falls back to provider origin",
  };
}

async function probeLinkedInProvider(
  env: Record<string, string | undefined>,
): Promise<void> {
  const rawUrl = env.LINKEDIN_PROVIDER_HEALTH_URL?.trim();
  if (!rawUrl) throw new Error("LINKEDIN_PROVIDER_HEALTH_URL is missing");
  const apiKey = env.LINKEDIN_PROVIDER_API_KEY?.trim();
  if (!apiKey) throw new Error("LINKEDIN_PROVIDER_API_KEY is missing");

  const res = await fetch(rawUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(READINESS_EXTERNAL_PROBE_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function formatNatsCredentialCheck(
  env: Record<string, string | undefined>,
  deps: ProductReadinessDeps,
): Promise<ProductReadinessCheck> {
  if (env.NODE_ENV !== "production") {
    return {
      name: "nats.credentials",
      status: "ok",
      detail: "Production NATS credential validation is active when NODE_ENV=production",
    };
  }

  const rawUrl = env.NATS_URL?.trim();
  if (!rawUrl) {
    return {
      name: "nats.credentials",
      status: "degraded",
      detail: "NATS_URL is missing",
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return {
      name: "nats.credentials",
      status: "degraded",
      detail: "NATS_URL is not a valid URL",
    };
  }

  const usesInlineAuth = Boolean(url.username || url.password);
  const needsCreds =
    !usesInlineAuth &&
    (url.protocol === "tls:" || url.hostname.endsWith("ngs.global"));
  if (!needsCreds) {
    return {
      name: "nats.credentials",
      status: "ok",
      detail: "NATS_URL does not require inline NKEY credentials",
    };
  }

  const creds = env.NATS_CREDS?.replace(/\\n/g, "\n").trim() ?? "";
  if (
    !creds.includes("-----BEGIN NATS USER JWT-----") ||
    !creds.includes("-----BEGIN USER NKEY SEED-----")
  ) {
    return {
      name: "nats.credentials",
      status: "degraded",
      detail: "NATS_CREDS must contain both the user JWT and user NKEY seed for NGS/TLS NATS",
    };
  }

  if (env.BOMBSELL_SUBSTRATE === "nats_restate") {
    try {
      await (deps.probeNatsConnection ?? probeNatsConnection)(env);
    } catch (err) {
      return {
        name: "nats.credentials",
        status: "degraded",
        detail: `NATS auth/connectivity check failed: ${readinessErrorMessage(err)}`,
      };
    }
  }

  return {
    name: "nats.credentials",
    status: "ok",
    detail:
      env.BOMBSELL_SUBSTRATE === "nats_restate"
        ? "NATS credentials authenticated successfully"
        : "NATS NKEY credentials look complete",
  };
}

async function probeNatsConnection(
  env: Record<string, string | undefined>,
): Promise<void> {
  const rawUrl = env.NATS_URL?.trim();
  if (!rawUrl) throw new Error("NATS_URL is missing");

  const creds = env.NATS_CREDS?.replace(/\\n/g, "\n").trim();
  const nc = await connect({
    servers: rawUrl,
    name: "bombsell-health",
    timeout: READINESS_EXTERNAL_PROBE_TIMEOUT_MS,
    reconnect: false,
    noRandomize: true,
    resolve: !new URL(rawUrl).hostname.endsWith("ngs.global"),
    ...(creds ? { authenticator: credsAuthenticator(new TextEncoder().encode(creds)) } : {}),
  });
  await nc.drain();
}

async function formatRestateIngressCheck(
  env: Record<string, string | undefined>,
  deps: ProductReadinessDeps,
): Promise<ProductReadinessCheck> {
  if (env.NODE_ENV !== "production") {
    return {
      name: "restate.ingress",
      status: "ok",
      detail: "Production Restate ingress validation is active when NODE_ENV=production",
    };
  }

  const rawUrl = env.RESTATE_INGRESS_URL?.trim();
  if (!rawUrl) {
    return {
      name: "restate.ingress",
      status: "degraded",
      detail: "RESTATE_INGRESS_URL is missing",
    };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    return {
      name: "restate.ingress",
      status: "degraded",
      detail: "RESTATE_INGRESS_URL must be an HTTP(S) URL",
    };
  }

  if (
    env.BOMBSELL_SUBSTRATE === "nats_restate" &&
    url.hostname.endsWith(".restate.cloud") &&
    !restateBearerFromEnv(env)
  ) {
    return {
      name: "restate.ingress",
      status: "degraded",
      detail: "RESTATE_BEARER_TOKEN is required for protected Restate Cloud ingress",
    };
  }

  if (env.BOMBSELL_SUBSTRATE === "nats_restate") {
    try {
      await Promise.all([
        (deps.probeRestateIngress ?? probeRestateIngress)(env),
        (deps.probeRestateServices ?? probeRestateServices)(env),
      ]);
    } catch (err) {
      return {
        name: "restate.ingress",
        status: "degraded",
        detail: `Restate ingress auth/connectivity check failed: ${readinessErrorMessage(err)}`,
      };
    }
  }

  return {
    name: "restate.ingress",
    status: "ok",
    detail: "Restate ingress URL is configured",
  };
}

function restateBearerFromEnv(env: Record<string, string | undefined>): string {
  return env.RESTATE_BEARER_TOKEN?.trim() || env.RESTATE_AUTH_TOKEN?.trim() || "";
}

async function probeRestateIngress(env: Record<string, string | undefined>): Promise<void> {
  const rawUrl = env.RESTATE_INGRESS_URL?.trim();
  if (!rawUrl) throw new Error("RESTATE_INGRESS_URL is missing");

  const bearer = restateBearerFromEnv(env);
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(rawUrl, {
    headers,
    signal: AbortSignal.timeout(READINESS_EXTERNAL_PROBE_TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`HTTP ${res.status}`);
  }
}

async function probeRestateServices(env: Record<string, string | undefined>): Promise<void> {
  const adminUrl = restateAdminUrl(env);
  if (!adminUrl) throw new Error("RESTATE_ADMIN_URL or RESTATE_INGRESS_URL is missing");

  const bearer = restateBearerFromEnv(env);
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(`${adminUrl}/deployments`, {
    headers,
    signal: AbortSignal.timeout(READINESS_EXTERNAL_PROBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`admin HTTP ${res.status}`);
  }

  const payload = await res.json() as RestateDeploymentsResponse;
  const summary = summarizeRestateDeployments(payload);
  if (summary.missing.length > 0) throw new Error(formatMissingRestateServices(summary));
  if (summary.incompleteRequiredDeployments.length > 0) {
    throw new Error(formatIncompleteRestateDeployments(summary));
  }
}

export function summarizeRestateDeployments(
  payload: RestateDeploymentsResponse,
  requiredServices: readonly string[] = REQUIRED_RESTATE_SERVICES,
): RestateDeploymentSummary {
  const deployments = (payload.deployments ?? []).map((deployment) => {
    const services = (deployment.services ?? [])
      .map((service) => service.name)
      .filter((name): name is string => Boolean(name))
      .sort();
    const serviceSet = new Set(services);
    return {
      id: deployment.id ?? null,
      uri: deployment.uri ?? deployment.endpoint ?? deployment.address ?? null,
      services,
      missingRequiredServices: requiredServices.filter((service) => !serviceSet.has(service)),
    };
  });
  const services = [...new Set(deployments.flatMap((deployment) => deployment.services))].sort();
  const serviceSet = new Set(services);
  const missing = requiredServices.filter((service) => !serviceSet.has(service));
  const requiredServiceSet = new Set(requiredServices);
  const incompleteRequiredDeployments = deployments.filter(
    (deployment) =>
      deployment.services.some((service) => requiredServiceSet.has(service)) &&
      deployment.missingRequiredServices.length > 0,
  );
  return { deployments, services, missing, incompleteRequiredDeployments };
}

function formatMissingRestateServices(summary: RestateDeploymentSummary): string {
  const deployments = summary.deployments.length
    ? summary.deployments
        .map((deployment) => {
          const services = deployment.services.length ? deployment.services.join("|") : "none";
          return `${deployment.id ?? "unknown"}@${deployment.uri ?? "unknown"}[${services}]`;
        })
        .join("; ")
    : "none";
  return `missing workflow services: ${summary.missing.join(", ")}; deployments: ${deployments}`;
}

function formatIncompleteRestateDeployments(summary: RestateDeploymentSummary): string {
  const deployments = summary.incompleteRequiredDeployments
    .map((deployment) => {
      const services = deployment.services.length ? deployment.services.join("|") : "none";
      return `${deployment.id ?? "unknown"}@${deployment.uri ?? "unknown"}[${services}] missing ${
        deployment.missingRequiredServices.join("|")
      }`;
    })
    .join("; ");
  return `incomplete workflow deployments still registered: ${deployments}`;
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

function formatSubstrateCheck(
  substrate: ReturnType<typeof resolveProductSubstrateMode>,
  env: Record<string, string | undefined>,
): ProductReadinessCheck {
  if (substrate.status !== "ok") {
    return {
      name: "substrate",
      status: "degraded",
      detail: substrate.detail,
    };
  }

  if (env.NODE_ENV === "production" && substrate.mode === "postgres") {
    return {
      name: "substrate",
      status: "degraded",
      detail:
        "Production product runtime is still using the Postgres event bus + workflow journal bridge; NATS/Restate are configured but not the active product substrate.",
    };
  }

  return {
    name: "substrate",
    status: "ok",
    detail: substrate.detail,
  };
}

async function missingRequiredTables(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ name: string }>(
    `select required.name
     from unnest($1::text[]) as required(name)
     where not exists (
       select 1
       from information_schema.tables
       where table_schema = current_schema()
         and table_name = required.name
         and table_type = 'BASE TABLE'
     )
     order by required.name`,
    [REQUIRED_TABLES],
  );
  return result.rows.map((row) => row.name);
}

async function missingRequiredMigrations(pool: Pool): Promise<string[]> {
  const result = await pool.query<{ filename: string }>(
    `select required.filename
     from unnest($1::text[]) as required(filename)
     where not exists (
       select 1
       from schema_migrations sm
       where sm.filename = required.filename
     )
     order by required.filename`,
    [REQUIRED_MIGRATIONS],
  );
  return result.rows.map((row) => row.filename);
}

function formatReadiness(checks: ProductReadinessCheck[]): ProductReadiness {
  const status = checks.some((check) => check.status === "degraded")
    ? "degraded"
    : checks.some((check) => check.status === "unconfigured")
      ? "unconfigured"
      : "ok";
  return {
    service: "bombsell-product",
    status,
    ready: status === "ok",
    checked_at: new Date().toISOString(),
    checks,
  };
}

function productReadinessCacheKey(
  pool: Pool | null,
  env: Record<string, string | undefined>,
  opts: { liveProbes: boolean; customDeps: boolean },
): string {
  return [
    pool ? "db" : "no-db",
    opts.liveProbes ? "live" : "config",
    opts.customDeps ? "custom-deps" : "default-deps",
    env.NODE_ENV ?? "",
    env.BOMBSELL_SUBSTRATE ?? "",
    env.NATS_URL?.trim() ? "nats" : "no-nats",
    env.RESTATE_INGRESS_URL?.trim() ? "restate" : "no-restate",
    env.LINKEDIN_PROVIDER_HEALTH_URL?.trim() ? "linkedin" : "no-linkedin",
    env.DATABASE_URL?.trim() ? "database-url" : "no-database-url",
  ].join("|");
}

function readinessErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return `timed out after ${READINESS_EXTERNAL_PROBE_TIMEOUT_MS}ms`;
    }
    return err.message;
  }
  return String(err);
}
