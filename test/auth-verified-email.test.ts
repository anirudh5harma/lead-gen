import { test } from "node:test";
import assert from "node:assert/strict";
import { hasVerifiedEmail } from "../lib/auth/verified-email.ts";

test("verified email accepts Supabase confirmed timestamps", () => {
  assert.equal(
    hasVerifiedEmail({
      email: "founder@example.com",
      email_confirmed_at: "2026-06-02T00:00:00.000Z",
    }),
    true,
  );
});

test("verified email accepts matching Google identity claim", () => {
  assert.equal(
    hasVerifiedEmail({
      email: "Founder@Example.com",
      identities: [
        {
          identity_data: {
            email: "founder@example.com",
            email_verified: true,
          },
        },
      ],
    }),
    true,
  );
});

test("verified email ignores user-editable metadata and mismatched identity emails", () => {
  assert.equal(
    hasVerifiedEmail({
      email: "founder@example.com",
      identities: [
        {
          identity_data: {
            email: "other@example.com",
            email_verified: true,
          },
        },
      ],
    }),
    false,
  );
});
