export type ProductEnvRequirement = "production" | "optional";

export interface ProductEnvVar {
  name: string;
  requirement: ProductEnvRequirement;
  category:
    | "auth"
    | "channels"
    | "database"
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
    name: "BOMBSELL_SUBSTRATE",
    requirement: "optional",
    category: "substrate",
    description: "Product substrate adapter. Currently supported production value is postgres.",
    example: "postgres",
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

export function requireOutboundEmailExecutionEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  requireProductionKeys("outbound email execution", OUTBOUND_EMAIL_PRODUCTION_KEYS, env);
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
