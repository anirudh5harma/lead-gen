import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLearnedModifier,
  SIGNAL_FEEDBACK_MAX_MODIFIER,
  SIGNAL_FEEDBACK_MIN_MODIFIER,
} from "../../core/ingest/feedback.ts";

test("signal feedback: cold start defaults to an exact 1.0 modifier", () => {
  assert.equal(computeLearnedModifier(0, 0), 1);
});

test("signal feedback: modifier increases monotonically with conversion rate", () => {
  const surfaced = 20;
  const low = computeLearnedModifier(1, surfaced);
  const medium = computeLearnedModifier(5, surfaced);
  const high = computeLearnedModifier(10, surfaced);

  assert.ok(low < medium);
  assert.ok(medium < high);
});

test("signal feedback: modifier stays clamped within configured bounds", () => {
  const low = computeLearnedModifier(0, 1_000);
  const high = computeLearnedModifier(1_000, 1_000);
  const mid = computeLearnedModifier(7, 19);

  assert.equal(low, SIGNAL_FEEDBACK_MIN_MODIFIER);
  assert.equal(high, SIGNAL_FEEDBACK_MAX_MODIFIER);
  assert.ok(mid >= SIGNAL_FEEDBACK_MIN_MODIFIER);
  assert.ok(mid <= SIGNAL_FEEDBACK_MAX_MODIFIER);
});
