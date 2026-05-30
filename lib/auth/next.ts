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
