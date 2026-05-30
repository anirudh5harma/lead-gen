import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/next";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const supabase = await createServerSupabaseClient();
  const h = await headers();
  const origin =
    process.env.APP_ORIGIN?.replace(/\/$/, "") ??
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });
  if (error || !data.url) {
    redirect(`/login?error=oauth&next=${encodeURIComponent(next)}`);
  }
  redirect(data.url);
}
