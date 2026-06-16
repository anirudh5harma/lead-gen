import assert from "node:assert/strict";
import test from "node:test";
import {
  isDailyCapExceeded,
  resolvePlayChannelPolicy,
  shouldRequestApproval,
} from "../core/plays/index.ts";

test("play autonomy: resolves per-channel approval and volume policy", () => {
  const policy = resolvePlayChannelPolicy(
    {
      channels: {
        email: {
          daily_cap: 12,
          approval: "approve_first",
        },
      },
      global: {},
    },
    "email",
  );

  assert.deepEqual(policy, {
    channel: "email",
    daily_cap: 12,
    approval: "approve_first",
  });
  assert.equal(shouldRequestApproval(policy, 0), true);
  assert.equal(shouldRequestApproval(policy, 1), false);
  assert.equal(isDailyCapExceeded(policy, 11), false);
  assert.equal(isDailyCapExceeded(policy, 12), true);
});

test("play autonomy: missing channel policy defaults to autonomous", () => {
  const policy = resolvePlayChannelPolicy(
    { channels: {}, global: {} },
    "email",
  );

  assert.deepEqual(policy, {
    channel: "email",
    daily_cap: 0,
    approval: "none",
  });
  assert.equal(shouldRequestApproval(policy, 0), false);
});

test("play autonomy: explicit run approval override can tighten or relax the channel gate", () => {
  const policy = resolvePlayChannelPolicy(
    {
      channels: {
        email: {
          daily_cap: "3",
          approval: "approve_first",
        },
      },
    },
    "email",
    { approval: "none" },
  );

  assert.deepEqual(policy, {
    channel: "email",
    daily_cap: 3,
    approval: "none",
  });
});

test("play autonomy: review every move and research-only keep their policy semantics", () => {
  const reviewEvery = resolvePlayChannelPolicy(
    {
      channels: {
        email: {
          daily_cap: 5,
          approval: "always",
        },
      },
    },
    "email",
  );
  const researchOnly = resolvePlayChannelPolicy(
    {
      channels: {
        email: {
          daily_cap: 5,
          approval: "research_only",
        },
      },
    },
    "email",
  );

  assert.equal(shouldRequestApproval(reviewEvery, 0), true);
  assert.equal(shouldRequestApproval(reviewEvery, 7), true);
  assert.equal(shouldRequestApproval(researchOnly, 0), false);
  assert.equal(researchOnly.approval, "research_only");
});
