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
  { key: "WORKER_DATABASE_POOL_MAX", tier: "optional", purpose: "Worker-specific Postgres pool sizing" },
  { key: "APP_ORIGIN", tier: "required", purpose: "Public callback and webhook origin" },
  { key: "NEXT_PUBLIC_APP_URL", tier: "optional", purpose: "Public MCP OAuth metadata origin override" },
  { key: "NEXT_PUBLIC_SUPABASE_URL", tier: "required", purpose: "Verified dashboard identity" },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", tier: "required", purpose: "Verified dashboard identity" },
  { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", tier: "optional", purpose: "Supabase publishable key alias" },
  { key: "SESSION_SECRET", tier: "required", purpose: "OAuth state integrity" },
  { key: "CREDENTIALS_ENCRYPTION_KEY", tier: "required", purpose: "Per-tenant OAuth token encryption" },
  { key: "BOMBSELL_ALLOW_DEMO_AUTH", tier: "optional", purpose: "Explicit local demo access" },
  { key: "BOMBSELL_DEMO_USER_ID", tier: "optional", purpose: "Seeded local demo identity" },
  { key: "BOMBSELL_DEMO_WORKSPACE_SLUG", tier: "optional", purpose: "Seeded local demo workspace" },
  { key: "BOMBSELL_SUBSTRATE", tier: "optional", purpose: "Product substrate adapter selection" },
  { key: "DEEPSEEK_API_KEY", tier: "feature", purpose: "Assistant reasoning brain, classification, and eval LLM" },
  { key: "DEEPSEEK_MODEL", tier: "optional", purpose: "LLM model selection" },
  { key: "DEEPSEEK_PROMPT_USD_PER_MILLION", tier: "optional", purpose: "LLM prompt-token cost override" },
  { key: "DEEPSEEK_COMPLETION_USD_PER_MILLION", tier: "optional", purpose: "LLM completion-token cost override" },
  { key: "BOMBSELL_LLM_DAILY_TOKEN_CAP", tier: "optional", purpose: "Default per-workspace LLM token cap" },
  { key: "OPENAI_API_KEY", tier: "feature", purpose: "Realtime voice transcription" },
  { key: "FIRECRAWL_API_KEY", tier: "feature", purpose: "Company website profile extraction" },
  { key: "FIRECRAWL_API_URL", tier: "optional", purpose: "Override Firecrawl scrape endpoint" },
  { key: "EXA_API_KEY", tier: "feature", purpose: "Exa public-web intelligence layer" },
  { key: "HUNTER_API_KEY", tier: "feature", purpose: "Hunter contact discovery and email verification" },
  { key: "HUNTER_API_BASE_URL", tier: "optional", purpose: "Optional Hunter API base URL override" },
  { key: "ZEROBOUNCE_API_KEY", tier: "feature", purpose: "ZeroBounce email deliverability verification" },
  { key: "ZEROBOUNCE_API_BASE_URL", tier: "optional", purpose: "Optional ZeroBounce validation API base URL override" },
  { key: "OUTREACH_PIPELINE_STRICT", tier: "optional", purpose: "Require connected-inbox readiness in outreach pipeline verifier" },
  { key: "OUTREACH_PIPELINE_LIVE_PROVIDER_SMOKE", tier: "optional", purpose: "Opt in to live Exa/Hunter/verification contact-resolution smoke" },
  { key: "OUTREACH_PIPELINE_VERIFY_COMPANY_NAME", tier: "optional", purpose: "Target company name for live outreach provider smoke" },
  { key: "OUTREACH_PIPELINE_VERIFY_COMPANY_DOMAIN", tier: "optional", purpose: "Target company domain for live outreach provider smoke" },
  { key: "OUTLOOK_REPAIR_WORKSPACE_ID", tier: "optional", purpose: "Limit Outlook subscription repair to one workspace" },
  { key: "OUTLOOK_REPAIR_LIMIT", tier: "optional", purpose: "Maximum Outlook accounts checked per repair workflow run" },
  { key: "BOMBSELL_EXA_DAILY_QUERY_CAP", tier: "optional", purpose: "Default per-workspace Exa live search cap per 24 hours" },
  { key: "BOMBSELL_EXA_DAILY_CONTENTS_CAP", tier: "optional", purpose: "Default per-workspace Exa content/result cap per 24 hours" },
  { key: "BOMBSELL_EXA_MONTHLY_UNIT_CAP", tier: "optional", purpose: "Default per-workspace Exa live request unit cap per month" },
  { key: "BOMBSELL_EXA_PLAY_RESEARCH_CAP", tier: "optional", purpose: "Default per-Play Exa live research cap per 24 hours" },
  { key: "BOMBSELL_RECOMMENDATION_RESEARCH_CADENCE_HOURS", tier: "optional", purpose: "Minimum cadence before recommendation-backed research refreshes" },
  { key: "PRODUCT_EVENT_DISPATCH_LIMIT", tier: "optional", purpose: "Production worker event-dispatch batch throttle" },
  { key: "PRODUCT_REDRIVE_SIGNAL_LIMIT", tier: "optional", purpose: "Production worker signal Play redrive throttle" },
  { key: "PRODUCT_REDRIVE_REPLY_LIMIT", tier: "optional", purpose: "Production worker reply Play redrive throttle" },
  { key: "PRODUCT_REDRIVE_RECOMMENDATION_LIMIT", tier: "optional", purpose: "Production worker recommendation redrive throttle" },
  { key: "AWS_REGION", tier: "optional", purpose: "Optional SES owned-domain sender and AWS-backed worker checks" },
  { key: "AWS_ACCESS_KEY_ID", tier: "optional", purpose: "Local AWS credentials" },
  { key: "AWS_SECRET_ACCESS_KEY", tier: "optional", purpose: "Local AWS credentials" },
  { key: "AWS_SESSION_TOKEN", tier: "optional", purpose: "Temporary AWS credentials" },
  { key: "AWS_SNS_TOPIC_ARNS", tier: "optional", purpose: "Trusted SES SNS ingress topics for the optional SES adapter" },
  { key: "AWS_SES_REQUIRED", tier: "optional", purpose: "Force optional SES readiness checks in production gate" },
  { key: "SES_SENDING_DOMAIN", tier: "optional", purpose: "SES verification expected sending identity" },
  { key: "SES_CONFIGURATION_SET", tier: "optional", purpose: "SES event publishing configuration set" },
  { key: "SNS_VERIFY_SIGNATURES", tier: "optional", purpose: "Local SNS test override" },
  { key: "MICROSOFT_CLIENT_ID", tier: "feature", purpose: "Outlook OAuth" },
  { key: "MICROSOFT_CLIENT_SECRET", tier: "feature", purpose: "Outlook OAuth" },
  { key: "MICROSOFT_REDIRECT_URI", tier: "feature", purpose: "Outlook OAuth callback" },
  { key: "MICROSOFT_TENANT_ID", tier: "optional", purpose: "Single-tenant Graph lifecycle-token issuer restriction" },
  { key: "OUTLOOK_DEFAULT_DAILY_CAP", tier: "optional", purpose: "Outlook send ceiling" },
  { key: "LINKEDIN_PROVIDER_URL", tier: "feature", purpose: "Native LinkedIn provider send endpoint" },
  { key: "LINKEDIN_PROVIDER_AUTH_URL", tier: "feature", purpose: "Native LinkedIn provider authorization handoff" },
  { key: "LINKEDIN_PROVIDER_HEALTH_URL", tier: "feature", purpose: "Native LinkedIn provider readiness check" },
  { key: "LINKEDIN_PROVIDER_API_KEY", tier: "feature", purpose: "Native LinkedIn provider bearer token" },
  { key: "LINKEDIN_PROVIDER_WEBHOOK_SECRET", tier: "feature", purpose: "Native LinkedIn provider lifecycle callback authentication" },
  { key: "LINKEDIN_REDIRECT_URI", tier: "optional", purpose: "Native LinkedIn provider callback override" },
  { key: "RESEND_API_KEY", tier: "feature", purpose: "Transactional email" },
  { key: "MANAGED_OWNED_DOMAIN_EMAIL_ENABLED", tier: "optional", purpose: "Explicitly enable optional managed owned-domain outbound transport" },
  { key: "RESEND_WEBHOOK_SECRET", tier: "feature", purpose: "Authenticated Resend webhook ingress" },
  { key: "DODO_API_KEY", tier: "required", purpose: "Dodo Payments billing API" },
  { key: "DODO_ENV", tier: "optional", purpose: "Dodo Payments environment selector" },
  { key: "DODO_WEBHOOK_SECRET", tier: "required", purpose: "Dodo Payments webhook signature verification" },
  { key: "DODO_PRODUCT_LAUNCH_MONTHLY", tier: "required", purpose: "Dodo Pro monthly product ID" },
  { key: "DODO_PRODUCT_LAUNCH_ANNUAL", tier: "required", purpose: "Dodo Pro annual product ID" },
  { key: "DODO_BUSINESS_ID", tier: "required", purpose: "Dodo customer portal business ID" },
  { key: "PRODUCT_HUNT_TOKEN", tier: "feature", purpose: "Product Hunt ingestion" },
  { key: "REDDIT_USER_AGENT", tier: "feature", purpose: "Reddit ingestion identity" },
  { key: "SEC_EDGAR_USER_AGENT", tier: "feature", purpose: "SEC EDGAR ingestion identity" },
  { key: "X_API_BEARER_TOKEN", tier: "feature", purpose: "Official X API search ingestion" },
  { key: "SOCIALDATA_API_KEY", tier: "feature", purpose: "SocialData X search ingestion" },
  { key: "TWITTERAPI_IO_API_KEY", tier: "feature", purpose: "TwitterAPI.io X search ingestion" },
  { key: "SIGNAL_WEBHOOK_SECRET", tier: "feature", purpose: "Authenticated source-backed Signal webhook ingress" },
  { key: "NATS_URL", tier: "required", purpose: "Production typed event bus" },
  { key: "NATS_CREDS", tier: "optional", purpose: "NATS NKEY+JWT creds (inline contents or file path) for Synadia/NGS auth" },
  { key: "NATS_STREAM_MAX_BYTES", tier: "optional", purpose: "NATS JetStream events stream byte cap" },
  { key: "NATS_STREAM_MAX_AGE_MS", tier: "optional", purpose: "NATS JetStream events stream retention age" },
  { key: "RESTATE_INGRESS_URL", tier: "required", purpose: "Production durable workflow runtime" },
  { key: "RESTATE_ADMIN_URL", tier: "optional", purpose: "Restate admin API for deployment verification" },
  { key: "RESTATE_ADMIN_TIMEOUT_MS", tier: "optional", purpose: "Restate admin API timeout for cutover verification" },
  { key: "RESTATE_BEARER_TOKEN", tier: "optional", purpose: "Bearer token for protected Restate ingress" },
  { key: "RESTATE_AUTH_TOKEN", tier: "optional", purpose: "Legacy alias for RESTATE_BEARER_TOKEN" },
  { key: "MAINTENANCE_TRIGGER_SECRET", tier: "required", purpose: "Authenticated durable maintenance ingress" },
  { key: "CRON_SECRET", tier: "optional", purpose: "Vercel-injected bearer; accepted by the maintenance route" },
  { key: "RESTATE_WORKFLOW_PORT", tier: "optional", purpose: "Restate workflow handler port" },
  { key: "RESTATE_WORKFLOW_HTTP1", tier: "optional", purpose: "Serve Restate workflow handlers over HTTP/1.1 for managed proxies" },
  { key: "RESTATE_ECS_CLUSTER", tier: "optional", purpose: "ECS cluster for Restate workflow health verification" },
  { key: "RESTATE_ECS_SERVICE", tier: "optional", purpose: "ECS service for Restate workflow health verification" },
  { key: "RESTATE_ECS_TARGET_GROUP_ARN", tier: "optional", purpose: "ALB target group ARN for Restate workflow target-health verification" },
  { key: "RESTATE_ECS_LOG_GROUP", tier: "optional", purpose: "CloudWatch log group for Restate workflow error scanning" },
  { key: "RESTATE_ECS_CONTAINER_NAME", tier: "optional", purpose: "Preferred ECS container name for Restate workflow log discovery" },
  { key: "RESTATE_ECS_LOG_LOOKBACK_MINUTES", tier: "optional", purpose: "CloudWatch log lookback for Restate ECS health verification" },
  { key: "RESTATE_ECS_LOG_SCAN_LIMIT", tier: "optional", purpose: "Maximum CloudWatch events scanned by Restate ECS health verification" },
  { key: "WORKER_TARGET_COMMAND", tier: "optional", purpose: "Managed worker target process selected by the container health wrapper" },
  { key: "WORKER_HEALTH_PORT", tier: "optional", purpose: "HTTP health port for managed background worker services" },
  { key: "RENDER_CLI", tier: "optional", purpose: "Render CLI path override for AWS exit cutover verification" },
  { key: "RENDER_BLUEPRINT_FILE", tier: "optional", purpose: "Render Blueprint file used by worker cutover or smoke verification" },
  { key: "RENDER_WORKER_SERVICE_NAME", tier: "optional", purpose: "Render service name expected by AWS exit cutover verification" },
  { key: "RENDER_WORKER_EXPECTED_PLAN", tier: "optional", purpose: "Render paid plan expected by AWS exit cutover verification" },
  { key: "RENDER_ALLOW_FREE_WORKER", tier: "optional", purpose: "Allow Render Free only for explicit smoke verification" },
  { key: "RENDER_SKIP_RESTATE_CUTOVER", tier: "optional", purpose: "Skip Restate URI verification for Render smoke checks" },
  { key: "RENDER_SKIP_RUNTIME_GATES", tier: "optional", purpose: "Skip runtime gates for Render smoke checks" },
  { key: "RENDER_WORKER_HEALTH_TIMEOUT_MS", tier: "optional", purpose: "Render worker health timeout for AWS exit cutover verification" },
  { key: "FLY_API_TOKEN", tier: "optional", purpose: "Fly.io API token for the Fly worker deploy script" },
  { key: "FLY_CLI", tier: "optional", purpose: "flyctl binary path override for the Fly worker deploy script" },
  { key: "FLY_CONFIG_FILE", tier: "optional", purpose: "Fly config file used by the worker deploy script" },
  { key: "FLY_ORG", tier: "optional", purpose: "Fly.io organization slug for the Fly worker app" },
  { key: "FLY_WORKER_ORG", tier: "optional", purpose: "Fallback Fly.io organization slug when FLY_ORG is unset" },
  { key: "FLY_WORKER_APP_NAME", tier: "optional", purpose: "Fly worker app name override for deploy and cutover verification" },
  { key: "FLY_SKIP_RESTATE_CUTOVER", tier: "optional", purpose: "Skip Restate URI verification for Fly smoke checks" },
  { key: "FLY_SKIP_RUNTIME_GATES", tier: "optional", purpose: "Skip runtime gates for Fly smoke checks" },
  { key: "ACTIVATION_VERIFY_AGGREGATOR_LIMIT", tier: "optional", purpose: "Activation verification signal aggregation limit" },
  { key: "KEEP_VERIFY_WORKSPACE", tier: "optional", purpose: "Keep activation verification workspace for inspection" },
  { key: "DASHBOARD_VERIFY_ORIGIN", tier: "optional", purpose: "Dashboard surface verifier origin override" },
  { key: "DASHBOARD_VERIFY_SCREENSHOTS", tier: "optional", purpose: "Dashboard surface verifier screenshot capture toggle" },
  { key: "PRODUCTION_APP_COOKIE_HEADER", tier: "optional", purpose: "Signed-in browser Cookie header for authenticated production app smoke checks" },
  { key: "PRODUCTION_APP_COOKIE", tier: "optional", purpose: "Legacy alias for PRODUCTION_APP_COOKIE_HEADER" },
  { key: "PRODUCTION_APP_BEARER_TOKEN", tier: "optional", purpose: "Supabase access token for authenticated production MCP smoke checks" },
  { key: "PRODUCTION_GATE_STRICT", tier: "optional", purpose: "Fail production gate on known wait/external states in CI" },
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
