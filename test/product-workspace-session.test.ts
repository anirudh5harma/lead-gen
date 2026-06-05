import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  assertProductWorkspaceAccess,
  verifiedProductWorkspaceSession,
  type ProductWorkspaceSession,
} from "../core/product/app.ts";

function productSession(): ProductWorkspaceSession {
  return {
    workspace_id: randomUUID(),
    user_id: randomUUID(),
  };
}

test("verified product workspace sessions skip redundant membership transactions", async () => {
  const verified = verifiedProductWorkspaceSession(productSession());
  const pool = {
    connect() {
      throw new Error("membership query should not run for verified sessions");
    },
  };

  await assert.doesNotReject(
    assertProductWorkspaceAccess(verified, pool as never),
  );
});

test("unverified product workspace sessions still fail closed through membership assertion", async () => {
  const pool = {
    connect() {
      throw new Error("membership assertion was attempted");
    },
  };

  await assert.rejects(
    assertProductWorkspaceAccess(productSession(), pool as never),
    /membership assertion was attempted/,
  );
});
