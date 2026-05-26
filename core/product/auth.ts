export type ProductUserSource =
  | "supabase"
  | "demo-cookie"
  | "demo-env"
  | "demo-default";

export interface ResolvedProductUser {
  user_id: string;
  source: ProductUserSource;
  demo: boolean;
}

export interface ResolveProductUserInput {
  verifiedAuthUserId?: string | null;
  cookieUserId?: string | null;
  envDemoUserId?: string | null;
  defaultDemoUserId: string;
  nodeEnv?: string;
  allowDemoAuth?: boolean | string | null;
}

export interface SupabaseAuthConfig {
  url: string;
  anonKey: string;
}

export function validUuid(value: string | undefined | null): string | null {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : null;
}

export function demoAuthAllowed(input: {
  nodeEnv?: string;
  allowDemoAuth?: boolean | string | null;
} = {}): boolean {
  if (input.allowDemoAuth === true) return true;
  if (typeof input.allowDemoAuth === "string") {
    const normalized = input.allowDemoAuth.toLowerCase();
    if (normalized === "1" || normalized === "true" || normalized === "yes") {
      return true;
    }
    if (normalized === "0" || normalized === "false" || normalized === "no") {
      return false;
    }
  }
  return (input.nodeEnv ?? "development") !== "production";
}

export function resolveProductUser(
  input: ResolveProductUserInput,
): ResolvedProductUser | null {
  const authUserId = validUuid(input.verifiedAuthUserId);
  if (authUserId) {
    return { user_id: authUserId, source: "supabase", demo: false };
  }

  if (
    !demoAuthAllowed({
      nodeEnv: input.nodeEnv,
      allowDemoAuth: input.allowDemoAuth,
    })
  ) {
    return null;
  }

  const cookieUserId = validUuid(input.cookieUserId);
  if (cookieUserId) {
    return { user_id: cookieUserId, source: "demo-cookie", demo: true };
  }

  const envUserId = validUuid(input.envDemoUserId);
  if (envUserId) {
    return { user_id: envUserId, source: "demo-env", demo: true };
  }

  const defaultUserId = validUuid(input.defaultDemoUserId);
  return defaultUserId
    ? { user_id: defaultUserId, source: "demo-default", demo: true }
    : null;
}

export function supabaseAuthConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SupabaseAuthConfig | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}
