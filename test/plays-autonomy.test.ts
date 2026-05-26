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
