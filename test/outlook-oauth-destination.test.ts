import assert from "node:assert/strict";
import { test } from "node:test";
import { outlookConnectedRedirectPath } from "../app/api/auth/outlook/destination.ts";

test("Outlook OAuth callback lands on an existing deliverability surface", () => {
  const path = outlookConnectedRedirectPath("11111111-1111-4111-8111-111111111111");

  assert.equal(
    path,
    "/dashboard/deliverability?outlook=connecting&channel_account_id=11111111-1111-4111-8111-111111111111",
  );
  assert.ok(!path.startsWith("/onboarding/outlook"));
});
