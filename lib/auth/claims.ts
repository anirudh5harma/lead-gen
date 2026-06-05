import { validUuid } from "./uuid.ts";

export interface RequestAuthIdentity {
  id: string;
  email: string | null;
  email_verified: boolean;
}

interface AuthClaimsLike {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
}

export function requestIdentityFromClaims(
  claims: AuthClaimsLike | null | undefined,
): RequestAuthIdentity | null {
  const id = validUuid(typeof claims?.sub === "string" ? claims.sub : null);
  if (!id) return null;

  return {
    id,
    email: normalizedEmail(claims?.email),
    email_verified:
      claimBoolean(claims?.email_verified) ||
      claimBoolean(claims?.user_metadata?.email_verified) ||
      claimBoolean(claims?.app_metadata?.email_verified),
  };
}

function normalizedEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function claimBoolean(value: unknown): boolean {
  return value === true || value === "true";
}
