import { normalizeWebsiteInputUrl } from "../network/website-input.ts";

export const PRODUCT_HOME_PATH = "/dashboard/outreach";
export const ONBOARDING_PATH = "/onboarding";
const DASHBOARD_ROOT_PATH = "/dashboard";

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
  if (
    hasCompletedOnboarding &&
    pathnameFor(next) === DASHBOARD_ROOT_PATH
  ) {
    return PRODUCT_HOME_PATH;
  }
  if (!hasCompletedOnboarding && isOnboardingPath(next)) return next;
  if (!hasCompletedOnboarding && requiresOnboarding(next)) return ONBOARDING_PATH;
  return next;
}

export function googleAuthPath(next: string): string {
  return `/auth/google?next=${encodeURIComponent(safeNextPath(next))}`;
}

export function canonicalAuthStartUrl({
  canonicalOrigin,
  next,
  requestUrl,
}: {
  canonicalOrigin: string;
  next: string;
  requestUrl: string;
}): string | null {
  const requestOrigin = originFromRequest(requestUrl);
  const normalizedCanonicalOrigin = canonicalOrigin.replace(/\/$/, "");
  if (requestOrigin === normalizedCanonicalOrigin) return null;
  return new URL(googleAuthPath(next), normalizedCanonicalOrigin).toString();
}

export function authCallbackOrigin({
  appOrigin = process.env.APP_ORIGIN,
  headers: _headers,
  nodeEnv = process.env.NODE_ENV,
  requestUrl,
}: {
  appOrigin?: string;
  headers: Pick<Headers, "get">;
  nodeEnv?: string;
  requestUrl: string;
}): string {
  const requestOrigin = originFromRequest(requestUrl);
  if (nodeEnv !== "production" && isLoopbackOrigin(requestOrigin)) {
    return requestOrigin;
  }
  return appOrigin?.replace(/\/$/, "") || requestOrigin;
}

export function onboardingPathForWebsite(value: string | null | undefined): string {
  const normalized = normalizeWebsiteInputUrl(value);
  if (!normalized) return ONBOARDING_PATH;
  return `${ONBOARDING_PATH}?url=${encodeURIComponent(normalized)}`;
}

function requiresOnboarding(value: string): boolean {
  const pathname = pathnameFor(value);
  return (
    pathname === DASHBOARD_ROOT_PATH ||
    pathname.startsWith(`${DASHBOARD_ROOT_PATH}/`) ||
    pathname === "/brief" ||
    pathname.startsWith("/brief/")
  );
}

function pathnameFor(value: string): string {
  return new URL(value, "https://bombsell.local").pathname;
}

function originFromRequest(requestUrl: string): string {
  return new URL(requestUrl).origin.replace(/\/$/, "");
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
