import { NextResponse } from "next/server";
import { reconcileWorkspaceMembershipsForAuthIdentity } from "@/core/product/app";
import { findCompletedOnboardingForUser } from "@/lib/auth/onboarding";
import { postAuthDestination, safeNextPath } from "@/lib/auth/next";
import { resolvePostAuthUserId } from "@/lib/auth/post-auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  ACTIVE_WORKSPACE_COOKIE_NAME,
  activeWorkspaceCookieOptions,
} from "@/lib/workspace";

interface PostAuthUser {
  id?: string | null;
  email?: string | null;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  if (!code) {
    return NextResponse.redirect(new URL(`/login?error=missing_code&next=${encodeURIComponent(next)}`, origin));
  }

  const supabase = await createServerSupabaseClient();
  const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=callback&next=${encodeURIComponent(next)}`, origin));
  }

  let authUser: PostAuthUser | null | undefined = exchangeData.user;
  const userId = await resolvePostAuthUserId(exchangeData.user, async () => {
    const { data } = await supabase.auth.getUser();
    authUser = data.user;
    return data.user;
  });
  if (userId && authUser?.id !== userId) {
    const { data } = await supabase.auth.getUser();
    authUser = data.user;
  }
  const completed = userId
    ? await findCompletedOnboardingAfterIdentityReconciliation(userId, authUser)
    : null;
  const destinationPath = postAuthDestination(next, Boolean(completed));
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const destination =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? new URL(destinationPath, origin)
      : new URL(destinationPath, `${forwardedProto}://${forwardedHost}`);
  const response = NextResponse.redirect(destination);
  if (completed) {
    response.cookies.set(
      ACTIVE_WORKSPACE_COOKIE_NAME,
      completed.workspace_id,
      activeWorkspaceCookieOptions(),
    );
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

async function findCompletedOnboardingAfterIdentityReconciliation(
  userId: string,
  user: PostAuthUser | null | undefined,
) {
  await reconcileWorkspaceMembershipsForAuthIdentity({
    user_id: userId,
    email: user?.email,
    email_verified: Boolean(user?.email_confirmed_at || user?.confirmed_at),
  });
  return findCompletedOnboardingForUser(userId);
}
