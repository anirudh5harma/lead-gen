import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isTransientConnectionError,
  withTransientConnectionRetry,
} from "../core/substrate/storage/index.ts";

test("transient connection operations retry once and preserve the result", async () => {
  let attempts = 0;
  const result = await withTransientConnectionRetry(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("timeout exceeded when trying to connect");
      }
      return "ready";
    },
    { delayMs: 0 },
  );

  assert.equal(result, "ready");
  assert.equal(attempts, 2);
});

test("permanent connection operations are not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    withTransientConnectionRetry(async () => {
      attempts += 1;
      throw new Error("workspace access denied");
    }),
    /workspace access denied/,
  );
  assert.equal(attempts, 1);
});

test("transient connection detection follows nested causes", () => {
  const error = new Error("workspace launch failed", {
    cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
  });

  assert.equal(isTransientConnectionError(error), true);
});
