import assert from "node:assert/strict";
import { test } from "node:test";
import { onboardingActionErrorMessage } from "../app/onboarding/errors.ts";

test("onboarding errors keep validation guidance specific", () => {
  assert.equal(
    onboardingActionErrorMessage(new Error("Enter a valid company website.")),
    "Enter a valid company website.",
  );
});

test("onboarding errors do not expose database connection details", () => {
  const message = onboardingActionErrorMessage(
    new Error("timeout exceeded when trying to connect"),
  );

  assert.equal(
    message,
    "Bombsell could not reach the workspace database. Your progress is safe; try again.",
  );
  assert.doesNotMatch(message, /timeout|connect/i);
});

test("onboarding errors hide unexpected infrastructure details", () => {
  const message = onboardingActionErrorMessage(
    new Error("password authentication failed for user service_role"),
  );

  assert.equal(
    message,
    "Bombsell could not launch your Agent just now. Your progress is safe; try again.",
  );
  assert.doesNotMatch(message, /password|service_role/i);
});
