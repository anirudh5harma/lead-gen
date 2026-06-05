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
} from "../lib/supabase/cookies.ts";

test("auth cookies expire after three days", () => {
  assert.equal(AUTH_SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 3);
  assert.equal(authSessionCookieOptions().maxAge, AUTH_SESSION_MAX_AGE_SECONDS);
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
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=259200/);
  assert.equal(response.headers.get("cache-control"), "private, no-cache, no-store");
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

test("public entry opens the protected app so existing sessions are reused", () => {
  const body = readFileSync("app/page.tsx", "utf8");
  assert.match(body, /href="\/dashboard"/);
  assert.doesNotMatch(body, /href="\/auth\/google\?next=%2Fdashboard"/);
});

test("proxy refreshes auth cookies with claims and accepts publishable keys", () => {
  const body = readFileSync("proxy.ts", "utf8");
  assert.match(body, /supabase\.auth\.getClaims\(\)/);
  assert.match(body, /supabaseAuthConfigFromEnv\(\)/);
});
