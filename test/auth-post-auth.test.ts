import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePostAuthUserId } from "../lib/auth/post-auth.ts";

const VALID_USER_ID = "11111111-1111-4111-8111-111111111111";
const FALLBACK_USER_ID = "22222222-2222-4222-8222-222222222222";

test("resolvePostAuthUserId uses the OAuth exchange user before reading cookies", async () => {
  let loadedFallback = false;
  const userId = await resolvePostAuthUserId({ id: VALID_USER_ID }, async () => {
    loadedFallback = true;
    return { id: FALLBACK_USER_ID };
  });

  assert.equal(userId, VALID_USER_ID);
  assert.equal(loadedFallback, false);
});

test("resolvePostAuthUserId falls back to verified user lookup when exchange user is missing", async () => {
  const userId = await resolvePostAuthUserId(null, async () => ({ id: FALLBACK_USER_ID }));

  assert.equal(userId, FALLBACK_USER_ID);
});

test("resolvePostAuthUserId ignores invalid user ids", async () => {
  const userId = await resolvePostAuthUserId({ id: "not-a-user-id" }, async () => null);

  assert.equal(userId, null);
});
