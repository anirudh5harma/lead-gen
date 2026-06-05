import type { CookieOptions } from "@supabase/ssr";
import type { NextResponse } from "next/server";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authSessionCookieOptions,
} from "../auth/session-cookie.ts";

export interface SupabaseCookieWrite {
  name: string;
  value: string;
  options: CookieOptions;
}

export interface SupabaseCookieCapture {
  cookies: SupabaseCookieWrite[];
  headers: Record<string, string>;
}

export function createSupabaseCookieCapture(): SupabaseCookieCapture {
  return { cookies: [], headers: {} };
}

export function applySupabaseCookieCapture(
  response: NextResponse,
  capture: SupabaseCookieCapture,
): void {
  for (const write of capture.cookies) {
    const { name, value, options } = normalizeSupabaseCookieWrite(write);
    response.cookies.set(name, value, options);
  }
  for (const [name, value] of Object.entries(capture.headers)) {
    response.headers.set(name, value);
  }
}

export function normalizeSupabaseCookieWrite(
  write: SupabaseCookieWrite,
): SupabaseCookieWrite {
  if (!isSupabaseAuthCookie(write.name) || isCookieDeletion(write)) {
    return write;
  }

  const defaults = authSessionCookieOptions();
  return {
    ...write,
    options: {
      ...write.options,
      path: write.options.path ?? defaults.path,
      sameSite: write.options.sameSite ?? defaults.sameSite,
      secure: write.options.secure ?? defaults.secure,
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    },
  };
}

function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("auth-token");
}

function isCookieDeletion(write: SupabaseCookieWrite): boolean {
  return !write.value || Number(write.options.maxAge) <= 0;
}
