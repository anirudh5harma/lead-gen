import { NextResponse } from "next/server";
import { findCompletedOnboardingForAuthIdentity } from "@/lib/auth/onboarding";
import {
  authCallbackOrigin,
  googleAuthPath,
  postAuthDestination,
  safeNextPath,
} from "@/lib/auth/next";
import { resolvePostAuthUserId } from "@/lib/auth/post-auth";
import { hasVerifiedEmail, type AuthVerifiedEmailUser } from "@/lib/auth/verified-email";
import {
  applySupabaseCookieCapture,
  createServerSupabaseClient,
  createSupabaseCookieCapture,
} from "@/lib/supabase/server";
import {
  ACTIVE_WORKSPACE_COOKIE_NAME,
  activeWorkspaceCookieOptions,
} from "@/lib/workspace";

interface PostAuthUser extends AuthVerifiedEmailUser {
  id?: string | null;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  const errParam = searchParams.get("error") ?? searchParams.get("error_description");
  if (errParam) {
    console.error("[auth/callback] provider error", errParam);
    return NextResponse.redirect(
      new URL(googleAuthPath(next) + "&error=callback", origin),
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL(googleAuthPath(next) + "&error=missing_code", origin),
    );
  }

  try {
    const supabaseCookies = createSupabaseCookieCapture();
    const supabase = await createServerSupabaseClient(supabaseCookies);
    const { data: exchangeData, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] exchangeCodeForSession error", error);
      return NextResponse.redirect(
        new URL(googleAuthPath(next) + "&error=callback", origin),
      );
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
    const destination = new URL(
      destinationPath,
      authCallbackOrigin({
        headers: request.headers,
        requestUrl: request.url,
      }),
    );
    const response = NextResponse.redirect(destination);
    applySupabaseCookieCapture(response, supabaseCookies);
    if (completed) {
      response.cookies.set(
        ACTIVE_WORKSPACE_COOKIE_NAME,
        completed.workspace_id,
        activeWorkspaceCookieOptions(),
      );
    }
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (err) {
    console.error("[auth/callback] unexpected error", err);
    return NextResponse.redirect(
      new URL(googleAuthPath(next) + "&error=callback", origin),
    );
  }
}

async function findCompletedOnboardingAfterIdentityReconciliation(
  userId: string,
  user: PostAuthUser | null | undefined,
) {
  return findCompletedOnboardingForAuthIdentity({
    id: userId,
    email: user?.email ?? null,
    email_verified: hasVerifiedEmail(user),
  });
}
