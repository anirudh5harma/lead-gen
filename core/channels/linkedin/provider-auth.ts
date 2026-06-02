export function resolveLinkedInProviderAuthUrl(
  env: Record<string, string | undefined> = process.env,
): URL | null {
  const explicit = env.LINKEDIN_PROVIDER_AUTH_URL?.trim();
  if (explicit) return new URL(explicit);
  const providerUrl = env.LINKEDIN_PROVIDER_URL?.trim();
  if (!providerUrl) return null;
  return new URL("/auth/linkedin/start", providerUrl);
}
