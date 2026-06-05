import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authSessionCookieOptions,
} from "../lib/auth/session-cookie.ts";

test("auth cookies expire after three days", () => {
  assert.equal(AUTH_SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 3);
  assert.equal(authSessionCookieOptions().maxAge, AUTH_SESSION_MAX_AGE_SECONDS);
  assert.match(
    readFileSync("lib/workspace.ts", "utf8"),
    /maxAge: AUTH_SESSION_MAX_AGE_SECONDS/,
  );
});
