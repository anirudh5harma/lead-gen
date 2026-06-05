import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authSessionCookieOptions } from "@/lib/auth/session-cookie";
import type {
  SupabaseCookieCapture,
  SupabaseCookieWrite,
} from "@/lib/supabase/cookies";
export {
  applySupabaseCookieCapture,
  createSupabaseCookieCapture,
} from "@/lib/supabase/cookies";

export async function createServerSupabaseClient(
  capture?: SupabaseCookieCapture,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase URL and public key are required for auth.");
  }
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookieOptions: authSessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet: SupabaseCookieWrite[], headers: Record<string, string> = {}) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies; Route Handlers and
          // Server Actions can. Auth callbacks use this helper in writable
          // contexts.
        }
        if (capture) {
          capture.cookies.push(...cookiesToSet);
          Object.assign(capture.headers, headers);
        }
      },
    },
  });
}
