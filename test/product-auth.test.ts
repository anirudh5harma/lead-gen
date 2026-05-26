import assert from "node:assert/strict";
import test from "node:test";
import {
  demoAuthAllowed,
  resolveProductUser,
  supabaseAuthConfigFromEnv,
  validUuid,
} from "../core/product/auth.ts";

const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000001";
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const COOKIE_USER_ID = "22222222-2222-4222-8222-222222222222";
const ENV_USER_ID = "33333333-3333-4333-8333-333333333333";

test("product auth: verified Supabase user wins over demo fallbacks", () => {
  const user = resolveProductUser({
    verifiedAuthUserId: AUTH_USER_ID,
    cookieUserId: COOKIE_USER_ID,
    envDemoUserId: ENV_USER_ID,
    defaultDemoUserId: DEFAULT_USER_ID,
    nodeEnv: "production",
  });

  assert.deepEqual(user, {
    user_id: AUTH_USER_ID,
    source: "supabase",
    demo: false,
  });
});

test("product auth: demo cookie/env/default fallback is development-only by default", () => {
  assert.equal(
    resolveProductUser({
      cookieUserId: COOKIE_USER_ID,
      envDemoUserId: ENV_USER_ID,
      defaultDemoUserId: DEFAULT_USER_ID,
      nodeEnv: "development",
    })?.source,
    "demo-cookie",
  );

  assert.equal(
    resolveProductUser({
      envDemoUserId: ENV_USER_ID,
      defaultDemoUserId: DEFAULT_USER_ID,
      nodeEnv: "test",
    })?.source,
    "demo-env",
  );

  assert.equal(
    resolveProductUser({
      defaultDemoUserId: DEFAULT_USER_ID,
      nodeEnv: "production",
    }),
    null,
  );
});

test("product auth: production demo fallback requires explicit opt-in", () => {
  const user = resolveProductUser({
    cookieUserId: COOKIE_USER_ID,
    defaultDemoUserId: DEFAULT_USER_ID,
    nodeEnv: "production",
    allowDemoAuth: "1",
  });

  assert.equal(user?.user_id, COOKIE_USER_ID);
  assert.equal(user?.source, "demo-cookie");
  assert.equal(user?.demo, true);
  assert.equal(demoAuthAllowed({ nodeEnv: "production", allowDemoAuth: "false" }), false);
});

test("product auth: invalid UUIDs are ignored", () => {
  assert.equal(validUuid("not-a-uuid"), null);
  assert.equal(
    resolveProductUser({
      verifiedAuthUserId: "not-a-uuid",
      cookieUserId: "also-not-a-uuid",
      envDemoUserId: ENV_USER_ID,
      defaultDemoUserId: DEFAULT_USER_ID,
      nodeEnv: "development",
    })?.user_id,
    ENV_USER_ID,
  );
});

test("product auth: Supabase config requires both public env values", () => {
  assert.equal(supabaseAuthConfigFromEnv({}), null);
  assert.equal(
    supabaseAuthConfigFromEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    }),
    null,
  );
  assert.deepEqual(
    supabaseAuthConfigFromEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    }),
    { url: "https://example.supabase.co", anonKey: "anon" },
  );
});
