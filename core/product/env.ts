export type ProductEnvRequirement = "production" | "optional";

export interface ProductEnvVar {
  name: string;
  requirement: ProductEnvRequirement;
  category:
    | "auth"
    | "channels"
    | "database"
    | "intelligence"
    | "llm"
    | "local"
    | "runtime"
    | "billing"
    | "substrate";
  description: string;
  example?: string;
}

export interface ProductEnvReport {
  status: "ok" | "degraded";
  missingProductionKeys: string[];
  configuredProductionKeys: string[];
  optionalKeys: string[];
}

export const OUTBOUND_EMAIL_PRODUCTION_KEYS = [
  "DEEPSEEK_API_KEY",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
] as const;

export type ProductEmailTransportMode = "resend" | "dry-run" | "unconfigured";
export type ProductLinkedInTransportMode = "provider" | "dry-run" | "unconfigured";

export class ProductEnvironmentError extends Error {
  readonly operation: string;
  readonly missingKeys: readonly string[];

  constructor(operation: string, missingKeys: readonly string[]) {
    super(
      `Production configuration missing for ${operation}: ${missingKeys.join(", ")}`,
    );
    this.name = "ProductEnvironmentError";
    this.operation = operation;
    this.missingKeys = missingKeys;
  }
}

export const PRODUCT_ENV_VARS: readonly ProductEnvVar[] = [
  {
    name: "DATABASE_URL",
    requirement: "production",
    category: "database",
    description: "Postgres connection string for product state, event log, graph, and workflows.",
    example: "postgresql://user:pass@127.0.0.1:5432/bombsell_prod",
  },
  {
    name: "DATABASE_POOL_MAX",
    requirement: "optional",
    category: "database",
    description: "Maximum Postgres pool size for the product runtime.",
    example: "10",
  },
  {
    name: "APP_ORIGIN",
    requirement: "production",
    category: "runtime",
    description: "Public origin used for OAuth callbacks, webhook URLs, and workflow repair links.",
    example: "https://app.example.com",
  },
  {
    name: "NEXT_PUBLIC_APP_URL",
    requirement: "optional",
    category: "runtime",
    description: "Optional public origin override used for MCP OAuth metadata.",
    example: "https://app.example.com",
  },
  {
    name: "BOMBSELL_SUBSTRATE",
    requirement: "optional",
    category: "substrate",
    description: "Product substrate adapter. Use nats_restate for production NATS + Restate, postgres for local/dev bridge.",
    example: "nats_restate",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    requirement: "production",
    category: "auth",
    description: "Supabase project URL used by SSR auth on product surfaces.",
    example: "https://your-project.supabase.co",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    requirement: "production",
    category: "auth",
    description: "Supabase anon key used by SSR auth on product surfaces.",
    example: "eyJhbGciOi...",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    requirement: "optional",
    category: "auth",
    description: "Supabase publishable key alias for projects using the newer key naming.",
  },
  {
    name: "SESSION_SECRET",
    requirement: "production",
    category: "auth",
    description: "Random secret used for OAuth state integrity.",
  },
  {
    name: "CREDENTIALS_ENCRYPTION_KEY",
    requirement: "production",
    category: "auth",
    description: "Base64-encoded 32-byte key for encrypted OAuth credentials.",
  },
  {
    name: "BOMBSELL_ALLOW_DEMO_AUTH",
    requirement: "optional",
    category: "local",
    description: "Set to 1 only for intentional demo auth outside local development.",
    example: "0",
  },
  {
    name: "BOMBSELL_DEMO_USER_ID",
    requirement: "optional",
    category: "local",
    description: "Development-only fallback user UUID for the brief surface.",
    example: "00000000-0000-4000-8000-000000000001",
  },
  {
    name: "BOMBSELL_DEMO_WORKSPACE_SLUG",
    requirement: "optional",
    category: "local",
    description: "Development-only fallback workspace slug for the brief surface.",
    example: "demo",
  },
  {
    name: "PRODUCTION_APP_COOKIE_HEADER",
    requirement: "optional",
    category: "runtime",
    description: "Full signed-in browser Cookie header used only by verify:production-app authenticated page checks.",
  },
  {
    name: "PRODUCTION_APP_COOKIE",
    requirement: "optional",
    category: "runtime",
    description: "Legacy alias for PRODUCTION_APP_COOKIE_HEADER used only by verify:production-app.",
  },
  {
    name: "PRODUCTION_APP_BEARER_TOKEN",
    requirement: "optional",
    category: "runtime",
    description: "Supabase access token used only by verify:production-app to verify authenticated MCP readiness discovery.",
  },
  {
    name: "DASHBOARD_VERIFY_ORIGIN",
    requirement: "optional",
    category: "runtime",
    description: "Origin override used only by the dashboard surface verifier.",
    example: "http://127.0.0.1:3023",
  },
  {
    name: "DASHBOARD_VERIFY_SCREENSHOTS",
    requirement: "optional",
    category: "runtime",
    description: "Set to 1 to capture screenshots during dashboard surface verification.",
    example: "0",
  },
  {
    name: "DEEPSEEK_API_KEY",
    requirement: "production",
    category: "llm",
    description: "Default LLM key for drafting, hot-path judges, classification, and dedup.",
    example: "sk-...",
  },
  {
    name: "DEEPSEEK_MODEL",
    requirement: "optional",
    category: "llm",
    description: "Override for the default DeepSeek model. Keep deepseek-v4-flash unless a call carries explicit Pro escalation.",
    example: "deepseek-v4-flash",
  },
  {
    name: "OPENAI_API_KEY",
    requirement: "production",
    category: "llm",
    description: "Embedding model key for signal ingestion and candidate dedup.",
    example: "sk-...",
  },
  {
    name: "FIRECRAWL_API_KEY",
    requirement: "production",
    category: "llm",
    description: "Firecrawl API key used to extract company website profiles during onboarding.",
    example: "fc-...",
  },
  {
    name: "FIRECRAWL_API_URL",
    requirement: "optional",
    category: "llm",
    description: "Optional override for the Firecrawl scrape endpoint.",
    example: "https://api.firecrawl.dev/v2/scrape",
  },
  {
    name: "EXA_API_KEY",
    requirement: "production",
    category: "intelligence",
    description: "Exa API key for public-web intelligence, profile enrichment, Agent research, draft grounding, open-web signals, and outreach evidence.",
    example: "exa_...",
  },
  {
    name: "HUNTER_API_KEY",
    requirement: "production",
    category: "intelligence",
    description: "Hunter API key for contact discovery, email finding, and fallback email verification. Required for launch — without it LinkedIn URL discovery and email finding degrade to empty results.",
    example: "hunter_...",
  },
  {
    name: "HUNTER_API_BASE_URL",
    requirement: "optional",
    category: "intelligence",
    description: "Optional Hunter API base URL override for tests or regional routing.",
    example: "https://api.hunter.io/v2",
  },
  {
    name: "ZEROBOUNCE_API_KEY",
    requirement: "optional",
    category: "intelligence",
    description: "Optional ZeroBounce API key for stricter email deliverability checks before outreach.",
  },
  {
    name: "ZEROBOUNCE_API_BASE_URL",
    requirement: "optional",
    category: "intelligence",
    description: "Optional ZeroBounce API base URL override. Defaults to the global v2 validation endpoint.",
    example: "https://api.zerobounce.net/v2",
  },
  {
    name: "BOMBSELL_EXA_DAILY_QUERY_CAP",
    requirement: "optional",
    category: "intelligence",
    description: "Default per-workspace Exa live search cap over the last 24 hours when workspace settings do not override it.",
    example: "50",
  },
  {
    name: "BOMBSELL_EXA_DAILY_CONTENTS_CAP",
    requirement: "optional",
    category: "intelligence",
    description: "Default per-workspace Exa content/result cap over the last 24 hours when workspace settings do not override it.",
    example: "500",
  },
  {
    name: "BOMBSELL_EXA_MONTHLY_UNIT_CAP",
    requirement: "optional",
    category: "intelligence",
    description: "Default per-workspace monthly Exa live request unit cap when workspace settings do not override it.",
    example: "1000",
  },
  {
    name: "BOMBSELL_EXA_PLAY_RESEARCH_CAP",
    requirement: "optional",
    category: "intelligence",
    description: "Default per-Play Exa live research cap over the last 24 hours when workspace settings do not override it.",
    example: "25",
  },
  {
    name: "BOMBSELL_RECOMMENDATION_RESEARCH_CADENCE_HOURS",
    requirement: "optional",
    category: "intelligence",
    description: "Minimum age, in hours, before recommendation-backed research refreshes can run again.",
    example: "24",
  },
  {
    name: "DEEPSEEK_PROMPT_USD_PER_MILLION",
    requirement: "optional",
    category: "llm",
    description: "Prompt-token cost override for workspace LLM usage estimates.",
    example: "0.14",
  },
  {
    name: "DEEPSEEK_COMPLETION_USD_PER_MILLION",
    requirement: "optional",
    category: "llm",
    description: "Completion-token cost override for workspace LLM usage estimates.",
    example: "0.28",
  },
  {
    name: "BOMBSELL_LLM_DAILY_TOKEN_CAP",
    requirement: "optional",
    category: "llm",
    description: "Default per-workspace 24-hour token cap when workspace settings do not override it.",
    example: "100000",
  },
  {
    name: "RESEND_API_KEY",
    requirement: "production",
    category: "channels",
    description: "Resend API key for transactional product email. Rep outbound does not use it unless MANAGED_OWNED_DOMAIN_EMAIL_ENABLED=1.",
    example: "re_...",
  },
  {
    name: "MANAGED_OWNED_DOMAIN_EMAIL_ENABLED",
    requirement: "optional",
    category: "channels",
    description: "Set to 1 only when intentionally enabling managed owned-domain outbound capacity. Customer-connected Outlook remains the default launch path.",
    example: "0",
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    requirement: "production",
    category: "channels",
    description: "Standard Webhooks secret for Resend delivery, bounce, and complaint callbacks.",
    example: "whsec_...",
  },
  {
    name: "DODO_API_KEY",
    requirement: "production",
    category: "billing",
    description: "Dodo Payments API key for Pro checkout sessions and customer portal sessions.",
  },
  {
    name: "DODO_ENV",
    requirement: "optional",
    category: "billing",
    description: "Dodo Payments environment selector. Use test_mode for sandbox checkouts; defaults to live_mode.",
    example: "live_mode",
  },
  {
    name: "DODO_WEBHOOK_SECRET",
    requirement: "production",
    category: "billing",
    description: "Dodo Payments standard webhook secret for subscription lifecycle callbacks.",
  },
  {
    name: "DODO_PRODUCT_LAUNCH_MONTHLY",
    requirement: "production",
    category: "billing",
    description: "Dodo product ID used for the Pro monthly subscription.",
  },
  {
    name: "DODO_PRODUCT_LAUNCH_ANNUAL",
    requirement: "production",
    category: "billing",
    description: "Dodo product ID used for the Pro annual subscription.",
  },
  {
    name: "DODO_BUSINESS_ID",
    requirement: "production",
    category: "billing",
    description: "Dodo business ID used for customer portal login fallback URLs.",
  },
  {
    name: "AWS_REGION",
    requirement: "optional",
    category: "channels",
    description: "AWS region for optional SES owned-domain sending and AWS-backed Restate worker health checks.",
    example: "us-east-1",
  },
  {
    name: "AWS_ACCESS_KEY_ID",
    requirement: "optional",
    category: "channels",
    description: "Local/static AWS access key for SES. Production should prefer a managed credential provider where available.",
  },
  {
    name: "AWS_SECRET_ACCESS_KEY",
    requirement: "optional",
    category: "channels",
    description: "Local/static AWS secret key for SES. Production should prefer a managed credential provider where available.",
  },
  {
    name: "AWS_SESSION_TOKEN",
    requirement: "optional",
    category: "channels",
    description: "Temporary AWS session token when using short-lived credentials.",
  },
  {
    name: "AWS_SNS_TOPIC_ARNS",
    requirement: "optional",
    category: "channels",
    description: "Comma-separated trusted SES SNS topic ARNs accepted by the optional SES inbound webhook.",
  },
  {
    name: "AWS_SES_REQUIRED",
    requirement: "optional",
    category: "channels",
    description: "Verifier-only flag. Set to 1 only when intentionally enabling the legacy SES managed-domain capacity path.",
    example: "0",
  },
  {
    name: "SES_SENDING_DOMAIN",
    requirement: "optional",
    category: "channels",
    description: "Expected SES identity checked by the AWS SES verification script.",
    example: "go.bombsell.com",
  },
  {
    name: "SES_CONFIGURATION_SET",
    requirement: "optional",
    category: "channels",
    description: "SES configuration set attached to outbound owned-domain sends for delivery, bounce, and complaint SNS events.",
    example: "bombsell-outbound",
  },
  {
    name: "SNS_VERIFY_SIGNATURES",
    requirement: "optional",
    category: "channels",
    description: "Local-only override. Set to 0 to skip SNS signature verification outside production.",
    example: "1",
  },
  {
    name: "PRODUCTION_GATE_STRICT",
    requirement: "optional",
    category: "channels",
    description: "Verifier-only flag. Set to 1 when CI should fail on known ECS wait or optional provider review states.",
    example: "0",
  },
  {
    name: "MICROSOFT_CLIENT_ID",
    requirement: "production",
    category: "channels",
    description: "Microsoft Graph OAuth application client id for Outlook.",
  },
  {
    name: "MICROSOFT_CLIENT_SECRET",
    requirement: "production",
    category: "channels",
    description: "Microsoft Graph OAuth application client secret for Outlook.",
  },
  {
    name: "MICROSOFT_REDIRECT_URI",
    requirement: "production",
    category: "channels",
    description: "Outlook OAuth callback URL registered with Microsoft.",
    example: "https://app.example.com/api/auth/outlook/callback",
  },
  {
    name: "MICROSOFT_TENANT_ID",
    requirement: "optional",
    category: "channels",
    description: "Optional tenant restriction for Graph lifecycle-token issuer validation.",
  },
  {
    name: "OUTLOOK_DEFAULT_DAILY_CAP",
    requirement: "optional",
    category: "channels",
    description: "Default per-account Outlook send ceiling.",
    example: "25",
  },
  {
    name: "OUTLOOK_REPAIR_WORKSPACE_ID",
    requirement: "optional",
    category: "channels",
    description: "Verifier-only override to repair Outlook subscriptions for one workspace.",
  },
  {
    name: "OUTLOOK_REPAIR_LIMIT",
    requirement: "optional",
    category: "channels",
    description: "Verifier-only maximum Outlook accounts checked per subscription repair workflow run.",
    example: "500",
  },
  {
    name: "LINKEDIN_PROVIDER_URL",
    requirement: "optional",
    category: "channels",
    description: "HTTP endpoint for the native LinkedIn session/OAuth provider send adapter.",
    example: "https://linkedin-provider.example.com/send",
  },
  {
    name: "LINKEDIN_PROVIDER_AUTH_URL",
    requirement: "optional",
    category: "channels",
    description: "Native LinkedIn provider authorization handoff URL. Defaults to /auth/linkedin/start on LINKEDIN_PROVIDER_URL origin.",
    example: "https://linkedin-provider.example.com/auth/linkedin/start",
  },
  {
    name: "LINKEDIN_PROVIDER_HEALTH_URL",
    requirement: "optional",
    category: "channels",
    description: "Native LinkedIn provider health endpoint used by production readiness checks.",
    example: "https://linkedin-provider.example.com/health",
  },
  {
    name: "LINKEDIN_PROVIDER_API_KEY",
    requirement: "optional",
    category: "channels",
    description: "Bearer token used by the native LinkedIn provider send adapter.",
  },
  {
    name: "LINKEDIN_PROVIDER_WEBHOOK_SECRET",
    requirement: "optional",
    category: "channels",
    description: "HMAC secret used to authenticate native LinkedIn provider lifecycle callbacks.",
  },
  {
    name: "LINKEDIN_REDIRECT_URI",
    requirement: "optional",
    category: "channels",
    description: "Override for the LinkedIn provider callback route.",
    example: "https://app.example.com/api/auth/linkedin/callback",
  },
  {
    name: "PRODUCT_HUNT_TOKEN",
    requirement: "optional",
    category: "channels",
    description: "Product Hunt ingestion token.",
  },
  {
    name: "X_API_BEARER_TOKEN",
    requirement: "optional",
    category: "intelligence",
    description: "Official X recent-search bearer token for workspace or pooled social signal ingestion.",
  },
  {
    name: "SOCIALDATA_API_KEY",
    requirement: "optional",
    category: "intelligence",
    description: "SocialData API key for usage-priced X search ingestion when that provider is selected.",
  },
  {
    name: "TWITTERAPI_IO_API_KEY",
    requirement: "optional",
    category: "intelligence",
    description: "TwitterAPI.io API key for the low-cost pooled X search source and workspace X experiments.",
  },
  {
    name: "REDDIT_USER_AGENT",
    requirement: "optional",
    category: "channels",
    description: "User agent sent to Reddit ingestion endpoints.",
  },
  {
    name: "SEC_EDGAR_USER_AGENT",
    requirement: "optional",
    category: "channels",
    description: "User agent sent to SEC EDGAR ingestion endpoints.",
  },
  {
    name: "SIGNAL_WEBHOOK_SECRET",
    requirement: "optional",
    category: "channels",
    description: "Shared secret accepted by /api/webhooks/signals for push signal ingress.",
  },
  {
    name: "NATS_URL",
    requirement: "production",
    category: "substrate",
    description: "NATS JetStream URL for the production typed event bus.",
    example: "nats://localhost:4222",
  },
  {
    name: "NATS_CREDS",
    requirement: "optional",
    category: "substrate",
    description:
      "NATS NKEY+JWT credentials (inline .creds contents or a file path) for Synadia/NGS auth. Optional: unauthenticated or URL-credentialed servers don't need it.",
    example: "/etc/nats/app.creds",
  },
  {
    name: "NATS_STREAM_MAX_BYTES",
    requirement: "optional",
    category: "substrate",
    description: "Maximum bytes retained by the NATS JetStream events stream.",
    example: "67108864",
  },
  {
    name: "NATS_STREAM_MAX_AGE_MS",
    requirement: "optional",
    category: "substrate",
    description: "Maximum event age retained by the NATS JetStream events stream.",
    example: "2592000000",
  },
  {
    name: "RESTATE_INGRESS_URL",
    requirement: "production",
    category: "substrate",
    description: "Restate ingress URL for durable workflow starts, status checks, and awakeable resolution.",
    example: "http://localhost:8080",
  },
  {
    name: "RESTATE_ADMIN_URL",
    requirement: "optional",
    category: "substrate",
    description:
      "Restate admin API URL for deployment verification. Defaults to RESTATE_INGRESS_URL with port 9070.",
    example: "http://localhost:9070",
  },
  {
    name: "RESTATE_ADMIN_TIMEOUT_MS",
    requirement: "optional",
    category: "substrate",
    description: "Timeout for Restate admin API checks used by the AWS exit cutover verifier.",
    example: "10000",
  },
  {
    name: "RESTATE_BEARER_TOKEN",
    requirement: "optional",
    category: "substrate",
    description: "Bearer token for protected Restate Cloud or self-hosted ingress.",
  },
  {
    name: "RESTATE_AUTH_TOKEN",
    requirement: "optional",
    category: "substrate",
    description: "Legacy alias for RESTATE_BEARER_TOKEN.",
  },
  {
    name: "MAINTENANCE_TRIGGER_SECRET",
    requirement: "production",
    category: "substrate",
    description: "Bearer secret accepted by the authenticated workflow maintenance route.",
  },
  {
    name: "CRON_SECRET",
    requirement: "optional",
    category: "substrate",
    description: "Vercel-injected bearer secret; accepted as an alternative maintenance route secret.",
  },
  {
    name: "RESTATE_WORKFLOW_PORT",
    requirement: "optional",
    category: "substrate",
    description: "Port for the Restate workflow handler process.",
    example: "9080",
  },
  {
    name: "RESTATE_WORKFLOW_HTTP1",
    requirement: "optional",
    category: "substrate",
    description: "Set to 1 when a managed proxy requires the Restate workflow handler to serve HTTP/1.1.",
    example: "1",
  },
  {
    name: "RESTATE_ECS_CLUSTER",
    requirement: "optional",
    category: "substrate",
    description: "ECS cluster checked by verify:restate-ecs-health.",
    example: "bombsell-workers",
  },
  {
    name: "RESTATE_ECS_SERVICE",
    requirement: "optional",
    category: "substrate",
    description: "ECS service checked by verify:restate-ecs-health.",
    example: "bombsell-restate-workflows",
  },
  {
    name: "RESTATE_ECS_TARGET_GROUP_ARN",
    requirement: "optional",
    category: "substrate",
    description: "Optional ALB target group ARN for Restate target-health verification; derived from the ECS service when absent.",
  },
  {
    name: "RESTATE_ECS_LOG_GROUP",
    requirement: "optional",
    category: "substrate",
    description: "Optional CloudWatch log group for Restate stream/health error scanning; derived from the task definition when absent.",
  },
  {
    name: "RESTATE_ECS_CONTAINER_NAME",
    requirement: "optional",
    category: "substrate",
    description: "Preferred ECS container name when deriving the Restate CloudWatch log group.",
  },
  {
    name: "RESTATE_ECS_LOG_LOOKBACK_MINUTES",
    requirement: "optional",
    category: "substrate",
    description: "Lookback window for verify:restate-ecs-health CloudWatch log and service-event scanning.",
    example: "60",
  },
  {
    name: "RESTATE_ECS_LOG_SCAN_LIMIT",
    requirement: "optional",
    category: "substrate",
    description: "Maximum CloudWatch log events scanned by verify:restate-ecs-health.",
    example: "200",
  },
  {
    name: "WORKER_TARGET_COMMAND",
    requirement: "optional",
    category: "runtime",
    description: "Target worker selected by the managed-worker health wrapper.",
    example: "worker:email-projectors",
  },
  {
    name: "WORKER_HEALTH_PORT",
    requirement: "optional",
    category: "runtime",
    description:
      "HTTP health port exposed by managed background workers. Leave unset to use the managed-worker default; Restate-capable targets default to 9081 so health does not collide with RESTATE_WORKFLOW_PORT.",
    example: "9081",
  },
  {
    name: "RENDER_CLI",
    requirement: "optional",
    category: "runtime",
    description: "Optional Render CLI path override for AWS exit cutover verification.",
    example: "/Users/example/.local/bin/render",
  },
  {
    name: "RENDER_BLUEPRINT_FILE",
    requirement: "optional",
    category: "runtime",
    description: "Render Blueprint file used by the worker cutover or free smoke verifier.",
    example: "render.yaml",
  },
  {
    name: "RENDER_WORKER_SERVICE_NAME",
    requirement: "optional",
    category: "runtime",
    description: "Render service name expected by the AWS exit cutover verifier.",
    example: "bombsell-production-worker",
  },
  {
    name: "RENDER_WORKER_EXPECTED_PLAN",
    requirement: "optional",
    category: "runtime",
    description: "Render always-on plan expected by the AWS exit cutover verifier.",
    example: "standard",
  },
  {
    name: "RENDER_ALLOW_FREE_WORKER",
    requirement: "optional",
    category: "runtime",
    description: "Set to 1 only for the explicit Render Free smoke verifier; production cutover rejects Free.",
    example: "0",
  },
  {
    name: "RENDER_SKIP_RESTATE_CUTOVER",
    requirement: "optional",
    category: "runtime",
    description: "Set to 1 for Render smoke checks that should not prove or modify Restate production routing.",
    example: "0",
  },
  {
    name: "RENDER_SKIP_RUNTIME_GATES",
    requirement: "optional",
    category: "runtime",
    description: "Set to 1 for Render smoke checks that should not run Restate runtime, outreach, or production app gates.",
    example: "0",
  },
  {
    name: "RENDER_WORKER_HEALTH_TIMEOUT_MS",
    requirement: "optional",
    category: "runtime",
    description: "Timeout for the Render worker /health check in the AWS exit cutover verifier.",
    example: "10000",
  },
  {
    name: "ACTIVATION_VERIFY_AGGREGATOR_LIMIT",
    requirement: "optional",
    category: "runtime",
    description: "Number of signals the activation verifier should aggregate during smoke checks.",
    example: "4",
  },
  {
    name: "KEEP_VERIFY_WORKSPACE",
    requirement: "optional",
    category: "runtime",
    description: "Set to 1 to keep the temporary activation verification workspace for inspection.",
    example: "1",
  },
  {
    name: "NODE_ENV",
    requirement: "optional",
    category: "runtime",
    description: "Runtime environment. Production readiness enforces production keys when set to production.",
    example: "production",
  },
] as const;

export function checkProductEnvironment(
  env: Record<string, string | undefined> = process.env,
): ProductEnvReport {
  const production = isProductionProductRuntime(env);
  const productionKeys = PRODUCT_ENV_VARS.filter(
    (item) => item.requirement === "production",
  ).map((item) => item.name);
  const missingProductionKeys = production
    ? productionKeys.filter((name) => !hasEnvValue(env[name]))
    : [];

  return {
    status: missingProductionKeys.length ? "degraded" : "ok",
    missingProductionKeys,
    configuredProductionKeys: productionKeys.filter((name) => hasEnvValue(env[name])),
    optionalKeys: PRODUCT_ENV_VARS.filter((item) => item.requirement === "optional").map(
      (item) => item.name,
    ),
  };
}

export function isProductionProductRuntime(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === "production";
}

export function requireProductionKeys(
  operation: string,
  keys: readonly string[],
  env: Record<string, string | undefined> = process.env,
): void {
  if (!isProductionProductRuntime(env)) return;
  const missing = keys.filter((key) => !hasEnvValue(env[key]));
  if (missing.length) {
    throw new ProductEnvironmentError(operation, missing);
  }
}

export function resolveProductEmailTransportMode(
  env: Record<string, string | undefined> = process.env,
): ProductEmailTransportMode {
  if (
    hasEnvValue(env.RESEND_API_KEY) &&
    env.MANAGED_OWNED_DOMAIN_EMAIL_ENABLED?.trim() === "1"
  ) {
    return "resend";
  }
  return isProductionProductRuntime(env) ? "unconfigured" : "dry-run";
}

export function resolveProductLinkedInTransportMode(
  env: Record<string, string | undefined> = process.env,
): ProductLinkedInTransportMode {
  if (hasEnvValue(env.LINKEDIN_PROVIDER_URL) && hasEnvValue(env.LINKEDIN_PROVIDER_API_KEY)) {
    return "provider";
  }
  return isProductionProductRuntime(env) ? "unconfigured" : "dry-run";
}

export function requireOutboundEmailExecutionEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  requireProductionKeys("outbound email execution", OUTBOUND_EMAIL_PRODUCTION_KEYS, env);
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
