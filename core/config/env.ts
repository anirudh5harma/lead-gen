export type EnvironmentTier = "required" | "feature" | "optional" | "platform";

export interface EnvironmentKey {
  key: string;
  tier: EnvironmentTier;
  purpose: string;
}

/**
 * Checked deployment contract. Every environment key read by application
 * code belongs here, including keys used only by an optional integration.
 */
export const ENVIRONMENT_KEYS: readonly EnvironmentKey[] = [
  { key: "NODE_ENV", tier: "platform", purpose: "Production safety mode" },
  { key: "DATABASE_URL", tier: "required", purpose: "Postgres substrate" },
  { key: "DATABASE_POOL_MAX", tier: "optional", purpose: "Postgres pool sizing" },
  { key: "APP_ORIGIN", tier: "required", purpose: "Public callback and webhook origin" },
  { key: "NEXT_PUBLIC_SUPABASE_URL", tier: "required", purpose: "Verified dashboard identity" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", tier: "required", purpose: "Verified dashboard identity" },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", tier: "optional", purpose: "Supabase publishable key alias" },
  { key: "SESSION_SECRET", tier: "required", purpose: "OAuth state integrity" },
  { key: "CREDENTIALS_ENCRYPTION_KEY", tier: "required", purpose: "Per-tenant OAuth token encryption" },
  { key: "BOMBSELL_ALLOW_DEMO_AUTH", tier: "optional", purpose: "Explicit local demo access" },
  { key: "BOMBSELL_DEMO_USER_ID", tier: "optional", purpose: "Seeded local demo identity" },
  { key: "BOMBSELL_DEMO_WORKSPACE_SLUG", tier: "optional", purpose: "Seeded local demo workspace" },
  { key: "BOMBSELL_SUBSTRATE", tier: "optional", purpose: "Product substrate adapter selection" },
  { key: "DEEPSEEK_API_KEY", tier: "feature", purpose: "Classification and eval LLM" },
  { key: "DEEPSEEK_MODEL", tier: "optional", purpose: "LLM model selection" },
  { key: "DEEPSEEK_PROMPT_USD_PER_MILLION", tier: "optional", purpose: "LLM prompt-token cost override" },
  { key: "DEEPSEEK_COMPLETION_USD_PER_MILLION", tier: "optional", purpose: "LLM completion-token cost override" },
  { key: "BOMBSELL_LLM_DAILY_TOKEN_CAP", tier: "optional", purpose: "Default per-workspace LLM token cap" },
  { key: "OPENAI_API_KEY", tier: "feature", purpose: "Signal embedding model" },
  { key: "FIRECRAWL_API_KEY", tier: "feature", purpose: "Company website profile extraction" },
  { key: "FIRECRAWL_API_URL", tier: "optional", purpose: "Override Firecrawl scrape endpoint" },
  { key: "AWS_REGION", tier: "feature", purpose: "SES owned-domain sender" },
  { key: "AWS_ACCESS_KEY_ID", tier: "optional", purpose: "Local AWS credentials" },
  { key: "AWS_SECRET_ACCESS_KEY", tier: "optional", purpose: "Local AWS credentials" },
  { key: "AWS_SESSION_TOKEN", tier: "optional", purpose: "Temporary AWS credentials" },
  { key: "AWS_SNS_TOPIC_ARNS", tier: "feature", purpose: "Trusted SES SNS ingress topics" },
  { key: "SES_SENDING_DOMAIN", tier: "optional", purpose: "SES verification expected sending identity" },
  { key: "SES_CONFIGURATION_SET", tier: "optional", purpose: "SES event publishing configuration set" },
  { key: "SNS_VERIFY_SIGNATURES", tier: "optional", purpose: "Local SNS test override" },
  { key: "MICROSOFT_CLIENT_ID", tier: "feature", purpose: "Outlook OAuth" },
  { key: "MICROSOFT_CLIENT_SECRET", tier: "feature", purpose: "Outlook OAuth" },
  { key: "MICROSOFT_REDIRECT_URI", tier: "feature", purpose: "Outlook OAuth callback" },
  { key: "MICROSOFT_TENANT_ID", tier: "optional", purpose: "Single-tenant Graph lifecycle-token issuer restriction" },
  { key: "OUTLOOK_DEFAULT_DAILY_CAP", tier: "optional", purpose: "Outlook send ceiling" },
  { key: "RESEND_API_KEY", tier: "feature", purpose: "Transactional email" },
  { key: "RESEND_WEBHOOK_SECRET", tier: "feature", purpose: "Authenticated Resend webhook ingress" },
  { key: "PRODUCT_HUNT_TOKEN", tier: "feature", purpose: "Product Hunt ingestion" },
  { key: "REDDIT_USER_AGENT", tier: "feature", purpose: "Reddit ingestion identity" },
  { key: "SEC_EDGAR_USER_AGENT", tier: "feature", purpose: "SEC EDGAR ingestion identity" },
  { key: "NATS_URL", tier: "required", purpose: "Production typed event bus" },
  { key: "NATS_CREDS", tier: "optional", purpose: "NATS NKEY+JWT creds (inline contents or file path) for Synadia/NGS auth" },
  { key: "NATS_STREAM_MAX_BYTES", tier: "optional", purpose: "NATS JetStream events stream byte cap" },
  { key: "NATS_STREAM_MAX_AGE_MS", tier: "optional", purpose: "NATS JetStream events stream retention age" },
  { key: "RESTATE_INGRESS_URL", tier: "required", purpose: "Production durable workflow runtime" },
  { key: "RESTATE_ADMIN_URL", tier: "optional", purpose: "Restate admin API for deployment verification" },
  { key: "RESTATE_BEARER_TOKEN", tier: "optional", purpose: "Bearer token for protected Restate ingress" },
  { key: "RESTATE_AUTH_TOKEN", tier: "optional", purpose: "Legacy alias for RESTATE_BEARER_TOKEN" },
  { key: "MAINTENANCE_TRIGGER_SECRET", tier: "required", purpose: "Authenticated durable maintenance ingress" },
  { key: "CRON_SECRET", tier: "optional", purpose: "Vercel-injected bearer; accepted by the maintenance route" },
  { key: "RESTATE_WORKFLOW_PORT", tier: "optional", purpose: "Restate workflow handler port" },
  { key: "RESTATE_WORKFLOW_HTTP1", tier: "optional", purpose: "Serve Restate workflow handlers over HTTP/1.1 for managed proxies" },
  { key: "WORKER_TARGET_COMMAND", tier: "optional", purpose: "Managed worker target process selected by the App Runner wrapper" },
  { key: "WORKER_HEALTH_PORT", tier: "optional", purpose: "HTTP health port for managed background worker services" },
] as const;

export const ENVIRONMENT_KEY_NAMES = new Set(ENVIRONMENT_KEYS.map(({ key }) => key));

export function missingRequiredProductionEnvironment(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return ENVIRONMENT_KEYS.filter(
    ({ tier, key }) => tier === "required" && !env[key]?.trim(),
  ).map(({ key }) => key);
}

export function missingFeatureEnvironment(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return ENVIRONMENT_KEYS.filter(
    ({ tier, key }) => tier === "feature" && !env[key]?.trim(),
  ).map(({ key }) => key);
}

export function isProduction(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NODE_ENV === "production";
}
