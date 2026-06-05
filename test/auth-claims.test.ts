import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestIdentityFromClaims } from "../lib/auth/claims.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("auth claims: resolves a verified request identity from JWT claims", () => {
  assert.deepEqual(
    requestIdentityFromClaims({
      sub: USER_ID,
      email: " Founder@Example.COM ",
      email_verified: true,
    }),
    {
      id: USER_ID,
      email: "founder@example.com",
      email_verified: true,
    },
  );
});

test("auth claims: accepts Supabase OAuth email verification in user metadata", () => {
  assert.deepEqual(
    requestIdentityFromClaims({
      sub: USER_ID,
      email: "founder@example.com",
      user_metadata: { email_verified: "true" },
    }),
    {
      id: USER_ID,
      email: "founder@example.com",
      email_verified: true,
    },
  );
});

test("auth claims: rejects missing or invalid subjects", () => {
  assert.equal(requestIdentityFromClaims(null), null);
  assert.equal(requestIdentityFromClaims({ sub: "not-a-user-id" }), null);
});

test("auth request identity uses verified claims instead of Auth user fetch", () => {
  const body = readFileSync("lib/auth.ts", "utf8");
  assert.match(body, /supabase\.auth\.getClaims\(\)/);
  assert.doesNotMatch(body, /supabase\.auth\.getUser\(\)/);
});
