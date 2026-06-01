import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
export { validUuid } from "@/lib/auth/uuid";
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

export async function getRequestUserId(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return localDemoUserId();

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anonKey, {
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
  const { data, error } = await supabase.auth.getUser();
  if (error) return localDemoUserId();
  return validUuid(data.user?.id) ?? localDemoUserId();
}
