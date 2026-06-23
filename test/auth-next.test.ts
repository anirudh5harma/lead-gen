import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authCallbackOrigin,
  googleAuthPath,
  onboardingPathForWebsite,
  postAuthDestination,
  safeNextPath,
} from "../lib/auth/next.ts";

test("safeNextPath preserves internal paths and query strings", () => {
  assert.equal(safeNextPath("/onboarding?url=https%3A%2F%2Facme.com"), "/onboarding?url=https%3A%2F%2Facme.com");
  assert.equal(safeNextPath("/dashboard"), "/dashboard");
});

test("safeNextPath rejects external or protocol-relative redirects", () => {
  assert.equal(safeNextPath("https://evil.example"), "/dashboard");
  assert.equal(safeNextPath("//evil.example"), "/dashboard");
  assert.equal(safeNextPath(null), "/dashboard");
});

test("googleAuthPath encodes sanitized next path", () => {
  assert.equal(
    googleAuthPath("/onboarding?url=https%3A%2F%2Facme.com"),
    "/auth/google?next=%2Fonboarding%3Furl%3Dhttps%253A%252F%252Facme.com",
  );
  assert.equal(googleAuthPath("https://evil.example"), "/auth/google?next=%2Fdashboard");
});

test("authCallbackOrigin uses loopback request origin during local development", () => {
  assert.equal(
    authCallbackOrigin({
      appOrigin: "https://www.bombsell.com",
      headers: new Headers({
        host: "localhost:3020",
        "x-forwarded-proto": "http",
      }),
      nodeEnv: "development",
      requestUrl: "http://localhost:3020/auth/google?next=%2Fdashboard",
    }),
    "http://localhost:3020",
  );
});

test("authCallbackOrigin honors APP_ORIGIN away from local development", () => {
  assert.equal(
    authCallbackOrigin({
      appOrigin: "https://www.bombsell.com/",
      headers: new Headers({
        host: "localhost:3020",
        "x-forwarded-proto": "http",
      }),
      nodeEnv: "production",
      requestUrl: "http://localhost:3020/auth/google?next=%2Fdashboard",
    }),
    "https://www.bombsell.com",
  );
});

test("authCallbackOrigin ignores forwarded host spoofing in production", () => {
  assert.equal(
    authCallbackOrigin({
      appOrigin: undefined,
      headers: new Headers({
        host: "internal.service",
        "x-forwarded-host": "evil.example",
        "x-forwarded-proto": "https",
      }),
      nodeEnv: "production",
      requestUrl: "https://www.bombsell.com/auth/google?next=%2Fdashboard",
    }),
    "https://www.bombsell.com",
  );
});

test("onboardingPathForWebsite normalizes company URLs for auth handoff", () => {
  assert.equal(
    onboardingPathForWebsite("acme.com"),
    "/onboarding?url=https%3A%2F%2Facme.com%2F",
  );
  assert.equal(
    onboardingPathForWebsite("https://acme.com/pricing?utm=launch"),
    "/onboarding?url=https%3A%2F%2Facme.com%2Fpricing%3Futm%3Dlaunch",
  );
  assert.equal(onboardingPathForWebsite(""), "/onboarding");
  assert.equal(onboardingPathForWebsite("https://"), "/onboarding");
});

test("postAuthDestination keeps completed users out of onboarding", () => {
  assert.equal(postAuthDestination("/onboarding", true), "/dashboard");
  assert.equal(
    postAuthDestination("/onboarding?url=https%3A%2F%2Facme.com", true),
    "/dashboard",
  );
  assert.equal(postAuthDestination("/dashboard", true), "/dashboard");
});

test("postAuthDestination sends new users to onboarding before app surfaces", () => {
  assert.equal(postAuthDestination("/dashboard", false), "/onboarding");
  assert.equal(postAuthDestination("/dashboard/campaigns", false), "/onboarding");
  assert.equal(postAuthDestination("/brief", false), "/onboarding");
  assert.equal(
    postAuthDestination("/onboarding?url=https%3A%2F%2Facme.com", false),
    "/onboarding?url=https%3A%2F%2Facme.com",
  );
});
