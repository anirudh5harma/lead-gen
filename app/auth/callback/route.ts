import { NextResponse } from "next/server";
import { findCompletedOnboardingForUser } from "@/lib/auth/onboarding";
import { postAuthDestination, safeNextPath } from "@/lib/auth/next";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  if (!code) {
    return NextResponse.redirect(new URL(`/login?error=missing_code&next=${encodeURIComponent(next)}`, origin));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=callback&next=${encodeURIComponent(next)}`, origin));
  }

  const { data } = await supabase.auth.getUser();
  const completed = data.user
    ? await findCompletedOnboardingForUser(data.user.id)
    : null;
  const destinationPath = postAuthDestination(next, Boolean(completed));
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const destination =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? new URL(destinationPath, origin)
      : new URL(destinationPath, `${forwardedProto}://${forwardedHost}`);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
