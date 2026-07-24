import type { CookieOptions } from "@supabase/ssr";

export const AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export function authSessionCookieOptions(): CookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  };
}
