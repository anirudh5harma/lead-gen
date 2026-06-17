import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("onboarding completion lands new users on Profile channels", () => {
  const source = readFileSync(new URL("../app/onboarding/actions.ts", import.meta.url), "utf8");

  assert.match(source, /POST_ONBOARDING_PATH = "\/dashboard\/profile#channels"/);
  assert.match(source, /redirect\(POST_ONBOARDING_PATH\)/);
  assert.match(source, /redirect\(PRODUCT_HOME_PATH\)/);
  assert.doesNotMatch(source, /redirect\(["']\/dashboard\/campaigns["']\)/);
});
