export const PRODUCT_HOME_PATH = "/dashboard";
export const ONBOARDING_PATH = "/onboarding";

export function safeNextPath(
  value: string | null | undefined,
  fallback = PRODUCT_HOME_PATH,
): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : fallback;
}

export function isOnboardingPath(value: string): boolean {
  return pathnameFor(value) === ONBOARDING_PATH;
}

export function postAuthDestination(
  requestedNext: string | null | undefined,
  hasCompletedOnboarding: boolean,
): string {
  const next = safeNextPath(requestedNext);
  if (hasCompletedOnboarding && isOnboardingPath(next)) return PRODUCT_HOME_PATH;
  if (!hasCompletedOnboarding && isOnboardingPath(next)) return next;
  if (!hasCompletedOnboarding && requiresOnboarding(next)) return ONBOARDING_PATH;
  return next;
}

export function googleAuthPath(next: string): string {
  return `/auth/google?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function authEntryPath(next: string): string {
  return `/auth/entry?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function onboardingPathForWebsite(value: string | null | undefined): string {
  const normalized = normalizeWebsiteInput(value);
  if (!normalized) return ONBOARDING_PATH;
  return `${ONBOARDING_PATH}?url=${encodeURIComponent(normalized)}`;
}

function normalizeWebsiteInput(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function requiresOnboarding(value: string): boolean {
  const pathname = pathnameFor(value);
  return (
    pathname === PRODUCT_HOME_PATH ||
    pathname.startsWith(`${PRODUCT_HOME_PATH}/`) ||
    pathname === "/brief" ||
    pathname.startsWith("/brief/")
  );
}

function pathnameFor(value: string): string {
  return new URL(value, "https://bombsell.local").pathname;
}
