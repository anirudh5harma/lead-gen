interface AuthIdentityData {
  email?: unknown;
  email_verified?: unknown;
}

interface AuthIdentity {
  identity_data?: AuthIdentityData | null;
}

export interface AuthVerifiedEmailUser {
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  identities?: AuthIdentity[] | null;
}

export function hasVerifiedEmail(
  user: AuthVerifiedEmailUser | null | undefined,
): boolean {
  if (!user) return false;
  if (user.email_confirmed_at || user.confirmed_at) return true;

  const userEmail = normalizedEmail(user.email);
  if (!userEmail) return false;

  return Boolean(
    user.identities?.some((identity) => {
      const data = identity.identity_data;
      if (!isTrue(data?.email_verified)) return false;
      return normalizedEmail(data?.email) === userEmail;
    }),
  );
}

function normalizedEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : null;
}

function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}
