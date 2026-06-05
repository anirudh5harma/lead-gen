import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAuthConfigFromEnv } from "@/core/product/auth";
import { googleAuthPath } from "@/lib/auth/next";
import { authSessionCookieOptions } from "@/lib/auth/session-cookie";
import { normalizeSupabaseCookieWrite } from "@/lib/supabase/cookies";

export async function proxy(request: NextRequest) {
  let response = nextWithPathname(request);
  const protectedRoute = isProtectedRoute(request);
  if (localDemoAuthAllowed()) return response;

  const config = supabaseAuthConfigFromEnv();
  if (!config) {
    return protectedRoute ? unauthenticatedResponse(request) : response;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookieOptions: authSessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        const normalizedCookies = cookiesToSet.map(normalizeSupabaseCookieWrite);
        normalizedCookies.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = nextWithPathname(request);
        normalizedCookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  if (protectedRoute && !data?.claims) {
    return unauthenticatedResponse(request);
  }
  return response;
}

function nextWithPathname(request: NextRequest): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

function isProtectedRoute(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;
  return (
    pathname === "/onboarding" ||
    pathname.startsWith("/dashboard") ||
    pathname === "/brief" ||
    pathname.startsWith("/brief/") ||
    pathname.startsWith("/api/auth/outlook") ||
    pathname.startsWith("/api/auth/microsoft-mail") ||
    pathname.startsWith("/api/internal/ops/dead-letter")
  );
}

function unauthenticatedResponse(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  return NextResponse.redirect(new URL(googleAuthPath(next), request.url));
}

function localDemoAuthAllowed(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.BOMBSELL_ALLOW_DEMO_AUTH === "1" &&
    Boolean(process.env.BOMBSELL_DEMO_USER_ID)
  );
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding",
    "/api/auth/outlook/:path*",
    "/api/auth/microsoft-mail/:path*",
    "/api/internal/ops/dead-letter/:path*",
    "/brief",
    "/brief/:path*",
  ],
};
