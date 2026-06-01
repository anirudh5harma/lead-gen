import { test } from "node:test";
import assert from "node:assert/strict";
import { findCompletedOnboardingForUser } from "../lib/auth/onboarding.ts";
import type { Pool } from "pg";

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("completed onboarding can be resolved from the durable profile event", async () => {
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /events e/);
      assert.match(sql, /workspace\.company\.profiled/);
      assert.deepEqual(params, [USER_ID]);
      return {
        rows: [
          {
            workspace_id: "22222222-2222-4222-8222-222222222222",
            completion_source: "workspace_company_profile",
          },
        ],
      };
    },
  } as unknown as Pool;

  const completed = await findCompletedOnboardingForUser(USER_ID, pool);

  assert.deepEqual(completed, {
    workspace_id: "22222222-2222-4222-8222-222222222222",
    completion_source: "workspace_company_profile",
  });
});

test("completed onboarding returns null when no workspace qualifies", async () => {
  const pool = {
    async query(_sql: string, params: unknown[]) {
      assert.deepEqual(params, [USER_ID]);
      return { rows: [] };
    },
  } as unknown as Pool;

  assert.equal(await findCompletedOnboardingForUser(USER_ID, pool), null);
});
