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
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
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
    description: "Override for the default DeepSeek model.",
    example: "deepseek-v4-pro",
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
    description: "Exa API key for public-web intelligence, profile enrichment, Rep research, draft grounding, open-web signals, content, and AEO.",
    example: "exa_...",
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
    description: "Resend API key for owned-domain email sends. Without it, local runs use dry-run transport.",
    example: "re_...",
  },
  {
    name: "RESEND_WEBHOOK_SECRET",
    requirement: "production",
    category: "channels",
    description: "Standard Webhooks secret for Resend delivery, bounce, and complaint callbacks.",
    example: "whsec_...",
  },
  {
    name: "AWS_REGION",
    requirement: "production",
    category: "channels",
    description: "AWS region for SES owned-domain sending and SNS verification.",
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
    requirement: "production",
    category: "channels",
    description: "Comma-separated trusted SES SNS topic ARNs accepted by the inbound webhook.",
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
    description: "HTTP health port exposed by managed background workers.",
    example: "9080",
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
  if (hasEnvValue(env.RESEND_API_KEY)) return "resend";
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
