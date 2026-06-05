import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { outlookConnectedRedirectPath } from "../app/api/auth/outlook/destination.ts";
import { callbackRedirectUri } from "../app/api/auth/outlook/callback/redirect-uri.ts";

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

test("Outlook OAuth state carries the exact callback redirect URI", () => {
  const startRoute = readFileSync("app/api/auth/outlook/route.ts", "utf8");
  const callbackRoute = readFileSync("app/api/auth/outlook/callback/route.ts", "utf8");

  assert.match(startRoute, /redirect_uri: redirectUri/);
  assert.match(startRoute, /redirect_uri\?: string/);
  assert.match(callbackRoute, /const redirectUri = callbackRedirectUri\(req, state\)/);
  assert.match(callbackRoute, /import \{ callbackRedirectUri \} from "\.\/redirect-uri\.ts"/);
});

test("Outlook callback uses the current legacy callback URI when old state has no redirect URI", () => {
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://www.bombsell.com";
  try {
    const req = {
      url: "https://www.bombsell.com/api/auth/microsoft-mail/callback?code=abc&state=old",
      nextUrl: new URL(
        "https://www.bombsell.com/api/auth/microsoft-mail/callback?code=abc&state=old",
      ),
    } as never;

    assert.equal(
      callbackRedirectUri(req, {}),
      "https://www.bombsell.com/api/auth/microsoft-mail/callback",
    );
  } finally {
    if (previous === undefined) {
      delete process.env.APP_ORIGIN;
    } else {
      process.env.APP_ORIGIN = previous;
    }
  }
});

test("Outlook callback prefers the signed state redirect URI", () => {
  const req = {
    url: "https://www.bombsell.com/api/auth/microsoft-mail/callback?code=abc&state=fresh",
    nextUrl: new URL(
      "https://www.bombsell.com/api/auth/microsoft-mail/callback?code=abc&state=fresh",
    ),
  } as never;

  assert.equal(
    callbackRedirectUri(req, {
      redirect_uri: "https://www.bombsell.com/api/auth/outlook/callback",
    }),
    "https://www.bombsell.com/api/auth/outlook/callback",
  );
});
