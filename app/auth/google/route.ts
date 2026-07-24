import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  authCallbackOrigin,
  canonicalAuthStartUrl,
  safeNextPath,
} from "@/lib/auth/next";
import {
  applySupabaseCookieCapture,
  createServerSupabaseClient,
  createSupabaseCookieCapture,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = safeNextPath(searchParams.get("next"));
  const requestedError = searchParams.get("error");
  if (requestedError) {
    return authFailureResponse(next, requestedError);
  }

  let originBase: string;
  try {
    const h = await headers();
    originBase = authCallbackOrigin({
      headers: h,
      requestUrl: request.url,
    });
  } catch (err) {
    console.error("[auth/google] origin resolve failed", err);
    return authFailureResponse(next, "origin");
  }

  const canonicalStartUrl = canonicalAuthStartUrl({
    canonicalOrigin: originBase,
    next,
    requestUrl: request.url,
  });
  if (canonicalStartUrl) {
    const response = NextResponse.redirect(canonicalStartUrl);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  let signInUrl: string | null = null;
  const supabaseCookies = createSupabaseCookieCapture();
  try {
    const supabase = await createServerSupabaseClient(supabaseCookies);
    const { data: claimsData } = await supabase.auth.getClaims();
    if (claimsData?.claims) {
      const response = NextResponse.redirect(new URL(next, request.url));
      applySupabaseCookieCapture(response, supabaseCookies);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${originBase}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: {
          prompt: "select_account",
        },
      },
    });
    if (error) {
      console.error("[auth/google] signInWithOAuth error", error);
      return authFailureResponse(next, "oauth");
    }
    if (!data?.url) {
      console.error("[auth/google] signInWithOAuth returned no url", data);
      return authFailureResponse(next, "oauth");
    }
    signInUrl = data.url;
  } catch (err) {
    console.error("[auth/google] unexpected error", err);
    return authFailureResponse(next, "oauth");
  }

  const response = NextResponse.redirect(signInUrl);
  applySupabaseCookieCapture(response, supabaseCookies);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function authFailureResponse(next: string, reason: string): Response {
  const retryHref = `/auth/google?next=${encodeURIComponent(next)}`;
  const safeReason = reason.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "oauth";
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in | Bombsell</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #08090b; color: #f4f4f5; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at top, #172033 0, #08090b 42%); }
      main { width: min(100%, 440px); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; background: rgba(12,14,18,.86); padding: 28px; box-shadow: 0 24px 80px rgba(0,0,0,.42); }
      p { margin: 0; color: #a1a1aa; line-height: 1.6; }
      .kicker { color: #79d7be; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
      h1 { margin: 12px 0 10px; font-size: 28px; line-height: 1.1; }
      a { margin-top: 22px; display: inline-flex; width: 100%; min-height: 44px; align-items: center; justify-content: center; border-radius: 8px; background: #f4f4f5; color: #08090b; font-weight: 700; text-decoration: none; }
      .reason { margin-top: 14px; font-size: 13px; color: #71717a; }
    </style>
  </head>
  <body>
    <main>
      <p class="kicker">Bombsell account</p>
      <h1>Sign in did not complete</h1>
      <p>Continue with Google again to get back to your workspace.</p>
      <p class="reason">Reason: ${safeReason}</p>
      <a href="${retryHref}">Continue with Google</a>
    </main>
  </body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    },
  );
}
