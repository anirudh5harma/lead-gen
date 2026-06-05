import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  requestIdentityFromClaims,
  type RequestAuthIdentity,
} from "@/lib/auth/claims";
import { authSessionCookieOptions } from "@/lib/auth/session-cookie";
export { validUuid } from "@/lib/auth/uuid";
export type { RequestAuthIdentity } from "@/lib/auth/claims";
import { validUuid } from "@/lib/auth/uuid";

function localDemoUserId(): string | null {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.BOMBSELL_ALLOW_DEMO_AUTH !== "1"
  ) {
    return null;
  }
  return validUuid(process.env.BOMBSELL_DEMO_USER_ID);
}

function demoIdentity(): RequestAuthIdentity | null {
  const id = localDemoUserId();
  return id ? { id, email: null, email_verified: false } : null;
}

export const getRequestAuthIdentity = cache(async (): Promise<RequestAuthIdentity | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return demoIdentity();

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookieOptions: authSessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Render-only server components rely on proxy refresh for writes.
        }
      },
    },
  });
  const { data, error } = await supabase.auth.getClaims();
  if (error) return demoIdentity();
  return requestIdentityFromClaims(data?.claims) ?? demoIdentity();
});

export async function getRequestUserId(): Promise<string | null> {
  return (await getRequestAuthIdentity())?.id ?? null;
}
