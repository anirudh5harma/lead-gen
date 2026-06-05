import type { NextRequest } from "next/server";

const OUTLOOK_CALLBACK_PATH = "/api/auth/outlook/callback";
const LEGACY_MICROSOFT_MAIL_CALLBACK_PATH = "/api/auth/microsoft-mail/callback";

export function callbackRedirectUri(
  req: NextRequest,
  state: { redirect_uri?: string },
): string {
  const stateRedirectUri = normalizedUrl(state.redirect_uri);
  if (stateRedirectUri) return stateRedirectUri;

  const currentCallbackUri = currentRequestCallbackUri(req);
  if (currentCallbackUri) return currentCallbackUri;

  const envRedirectUri = normalizedUrl(process.env.MICROSOFT_REDIRECT_URI);
  if (envRedirectUri) return envRedirectUri;

  return `${appOrigin(req)}${OUTLOOK_CALLBACK_PATH}`;
}

function currentRequestCallbackUri(req: NextRequest): string | null {
  const pathname = req.nextUrl.pathname;
  if (
    pathname !== OUTLOOK_CALLBACK_PATH &&
    pathname !== LEGACY_MICROSOFT_MAIL_CALLBACK_PATH
  ) {
    return null;
  }
  return `${appOrigin(req)}${pathname}`;
}

function normalizedUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    return new URL(normalized).toString();
  } catch {
    return null;
  }
}

function appOrigin(req: NextRequest): string {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}
