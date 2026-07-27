import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server.js";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authSessionCookieOptions,
} from "../lib/auth/session-cookie.ts";
import {
  applySupabaseCookieCapture,
  createSupabaseCookieCapture,
  normalizeSupabaseCookieWrite,
} from "../lib/supabase/cookies.ts";

test("auth cookies expire after seven days", () => {
  assert.equal(AUTH_SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 7);
  assert.equal(authSessionCookieOptions().maxAge, AUTH_SESSION_MAX_AGE_SECONDS);
  assert.equal(authSessionCookieOptions().httpOnly, true);
  assert.match(
    readFileSync("lib/workspace.ts", "utf8"),
    /maxAge: AUTH_SESSION_MAX_AGE_SECONDS/,
  );
});

test("Supabase cookie capture applies auth cookies and cache headers to redirects", () => {
  const capture = createSupabaseCookieCapture();
  capture.cookies.push({
    name: "sb-test-auth-token",
    value: "session",
    options: authSessionCookieOptions(),
  });
  capture.headers["Cache-Control"] = "private, no-cache, no-store";

  const response = NextResponse.redirect("https://www.bombsell.com/dashboard");
  applySupabaseCookieCapture(response, capture);

  assert.match(response.headers.get("set-cookie") ?? "", /sb-test-auth-token=session/);
  assert.match(
    response.headers.get("set-cookie") ?? "",
    new RegExp(`Max-Age=${AUTH_SESSION_MAX_AGE_SECONDS}`),
  );
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
  assert.equal(response.headers.get("cache-control"), "private, no-cache, no-store");
});

test("Supabase auth cookie writes are capped to seven days", () => {
  const normalized = normalizeSupabaseCookieWrite({
    name: "sb-test-auth-token",
    value: "session",
    options: { path: "/", maxAge: 60 * 60 * 24 * 30 },
  });

  assert.equal(normalized.options.maxAge, AUTH_SESSION_MAX_AGE_SECONDS);
});

test("Supabase auth cookie deletion keeps its zero max-age", () => {
  const normalized = normalizeSupabaseCookieWrite({
    name: "sb-test-auth-token",
    value: "",
    options: { path: "/", maxAge: 0 },
  });

  assert.equal(normalized.options.maxAge, 0);
});

test("auth route redirects replay Supabase cookie writes", () => {
  for (const file of [
    "app/auth/google/route.ts",
    "app/auth/callback/route.ts",
    "app/auth/sign-out/route.ts",
  ]) {
    const body = readFileSync(file, "utf8");
    assert.match(body, /createSupabaseCookieCapture/);
    assert.match(body, /createServerSupabaseClient\(supabaseCookies\)/);
    assert.match(body, /applySupabaseCookieCapture\(response, supabaseCookies\)/);
  }
});

test("sign out clears both the auth session and active workspace", () => {
  const signOutRoute = readFileSync("app/auth/sign-out/route.ts", "utf8");
  assert.match(signOutRoute, /supabase\.auth\.signOut\(\)/);
  assert.match(
    signOutRoute,
    /response\.cookies\.delete\(ACTIVE_WORKSPACE_COOKIE_NAME\)/,
  );
});

test("public entry sends login directly to Google OAuth", () => {
  const body = readFileSync("app/page.tsx", "utf8");
  // The login link lives in the shared marketing chrome rendered by the
  // public pages; the onboarding CTA + url form stay on the landing page.
  const chrome = readFileSync("components/marketing/MarketingChrome.tsx", "utf8");
  const authStart = readFileSync("app/auth/start/route.ts", "utf8");
  assert.match(chrome, /href=\{googleAuthPath\(PRODUCT_HOME_PATH\)\}/);
  assert.match(body, /href=\{googleAuthPath\('\/onboarding'\)\}/);
  assert.match(body, /action="\/auth\/start"/);
  assert.doesNotMatch(body, /action="\/onboarding"/);
  assert.doesNotMatch(body, /href="\/login"/);
  assert.doesNotMatch(body, /href="\/onboarding"/);
  assert.doesNotMatch(chrome, /href="\/login"/);
  assert.match(authStart, /googleAuthPath\(next\)/);
  assert.match(authStart, /onboardingPathForWebsite\(searchParams\.get\("url"\)\)/);
});

test("public entry sends an active session to the product dashboard", () => {
  const body = readFileSync("app/page.tsx", "utf8");

  assert.match(body, /getRequestAuthIdentity/);
  assert.match(body, /if \(identity\) redirect\(PRODUCT_HOME_PATH\)/);
  assert.match(body, /export const dynamic = 'force-dynamic'/);
});

test("auth failures stay on the direct Google auth surface", () => {
  const googleRoute = readFileSync("app/auth/google/route.ts", "utf8");
  const callbackRoute = readFileSync("app/auth/callback/route.ts", "utf8");
  assert.doesNotMatch(googleRoute, /\/login/);
  assert.doesNotMatch(callbackRoute, /\/login/);
  assert.match(callbackRoute, /googleAuthPath\(next\) \+ "&error=/);
});

test("Google auth reuses an existing session instead of restarting OAuth", () => {
  const googleRoute = readFileSync("app/auth/google/route.ts", "utf8");
  assert.match(googleRoute, /supabase\.auth\.getClaims\(\)/);
  assert.match(googleRoute, /if \(claimsData\?\.claims\)/);
  assert.match(googleRoute, /NextResponse\.redirect\(new URL\(next, request\.url\)\)/);
  assert.doesNotMatch(googleRoute, /prompt: "consent"/);
});

test("proxy refreshes auth cookies with claims and accepts publishable keys", () => {
  const body = readFileSync("proxy.ts", "utf8");
  assert.match(body, /supabase\.auth\.getClaims\(\)/);
  assert.match(body, /supabaseAuthConfigFromEnv\(\)/);
});
