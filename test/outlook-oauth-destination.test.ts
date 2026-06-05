import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("legacy Microsoft mail callback route uses the Outlook callback handler", () => {
  const route = readFileSync(
    "app/api/auth/microsoft-mail/callback/route.ts",
    "utf8",
  );
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /export \{ GET \} from "\.\.\/\.\.\/outlook\/callback\/route"/);
});
