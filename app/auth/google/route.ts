import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { safeNextPath } from "@/lib/auth/next";
import {
  applySupabaseCookieCapture,
  createServerSupabaseClient,
  createSupabaseCookieCapture,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const loginUrl = (reason: string) =>
    new URL(`/login?error=${reason}&next=${encodeURIComponent(next)}`, request.url);

  let originBase: string;
  try {
    const h = await headers();
    originBase =
      process.env.APP_ORIGIN?.replace(/\/$/, "") ??
      `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? new URL(request.url).host}`;
  } catch (err) {
    console.error("[auth/google] origin resolve failed", err);
    return NextResponse.redirect(loginUrl("origin"));
  }

  let signInUrl: string | null = null;
  const supabaseCookies = createSupabaseCookieCapture();
  try {
    const supabase = await createServerSupabaseClient(supabaseCookies);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${originBase}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });
    if (error) {
      console.error("[auth/google] signInWithOAuth error", error);
      return NextResponse.redirect(loginUrl("oauth"));
    }
    if (!data?.url) {
      console.error("[auth/google] signInWithOAuth returned no url", data);
      return NextResponse.redirect(loginUrl("oauth"));
    }
    signInUrl = data.url;
  } catch (err) {
    console.error("[auth/google] unexpected error", err);
    return NextResponse.redirect(loginUrl("oauth"));
  }

  const response = NextResponse.redirect(signInUrl);
  applySupabaseCookieCapture(response, supabaseCookies);
  return response;
}
