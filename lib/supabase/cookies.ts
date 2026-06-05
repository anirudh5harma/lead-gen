import type { CookieOptions } from "@supabase/ssr";
import type { NextResponse } from "next/server";

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
  for (const { name, value, options } of capture.cookies) {
    response.cookies.set(name, value, options);
  }
  for (const [name, value] of Object.entries(capture.headers)) {
    response.headers.set(name, value);
  }
}
