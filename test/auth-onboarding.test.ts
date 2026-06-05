import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findCompletedOnboardingForAuthIdentity,
  findCompletedOnboardingForUser,
} from "../lib/auth/onboarding.ts";
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

test("completed onboarding returns null when the user has no accepted workspace", async () => {
  const pool = {
    async query(_sql: string, params: unknown[]) {
      assert.deepEqual(params, [USER_ID]);
      return { rows: [] };
    },
  } as unknown as Pool;

  assert.equal(await findCompletedOnboardingForUser(USER_ID, pool), null);
});

test("completed onboarding falls back to an accepted workspace for returning users", async () => {
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /from candidate_workspaces/);
      assert.doesNotMatch(sql, /where has_workspace_company_profile/);
      assert.deepEqual(params, [USER_ID]);
      return {
        rows: [
          {
            workspace_id: "33333333-3333-4333-8333-333333333333",
            completion_source: "accepted_workspace",
          },
        ],
      };
    },
  } as unknown as Pool;

  const completed = await findCompletedOnboardingForUser(USER_ID, pool);

  assert.deepEqual(completed, {
    workspace_id: "33333333-3333-4333-8333-333333333333",
    completion_source: "accepted_workspace",
  });
});

test("completed onboarding skips identity repair for already-onboarded users", async () => {
  let reconciled = false;
  const pool = {
    async query(_sql: string, params: unknown[]) {
      assert.deepEqual(params, [USER_ID]);
      return {
        rows: [
          {
            workspace_id: "44444444-4444-4444-8444-444444444444",
            completion_source: "workspace_company_profile",
          },
        ],
      };
    },
  } as unknown as Pool;

  const completed = await findCompletedOnboardingForAuthIdentity(
    {
      id: USER_ID,
      email: "Founder@Example.com",
      email_verified: true,
    },
    pool,
    {
      async reconcileWorkspaceMemberships() {
        reconciled = true;
        return [];
      },
    },
  );

  assert.equal(reconciled, false);
  assert.deepEqual(completed, {
    workspace_id: "44444444-4444-4444-8444-444444444444",
    completion_source: "workspace_company_profile",
  });
});

test("completed onboarding repairs verified auth identity when no workspace is visible", async () => {
  let queryCount = 0;
  let reconciled: unknown = null;
  let reconcileDeps: unknown = null;
  const pool = {
    async query(_sql: string, params: unknown[]) {
      queryCount += 1;
      assert.deepEqual(params, [USER_ID]);
      if (queryCount === 1) return { rows: [] };
      return {
        rows: [
          {
            workspace_id: "44444444-4444-4444-8444-444444444444",
            completion_source: "accepted_workspace",
          },
        ],
      };
    },
  } as unknown as Pool;

  const completed = await findCompletedOnboardingForAuthIdentity(
    {
      id: USER_ID,
      email: "Founder@Example.com",
      email_verified: true,
    },
    pool,
    {
      async reconcileWorkspaceMemberships(input, deps) {
        reconciled = input;
        reconcileDeps = deps;
        return [{ workspace_id: "44444444-4444-4444-8444-444444444444", role: "owner" }];
      },
    },
  );

  assert.deepEqual(reconciled, {
    user_id: USER_ID,
    email: "Founder@Example.com",
    email_verified: true,
  });
  assert.deepEqual(reconcileDeps, { pool });
  assert.equal(queryCount, 2);
  assert.deepEqual(completed, {
    workspace_id: "44444444-4444-4444-8444-444444444444",
    completion_source: "accepted_workspace",
  });
});

test("completed onboarding does not repair unverified auth identities", async () => {
  let reconciled = false;
  const pool = {
    async query(_sql: string, params: unknown[]) {
      assert.deepEqual(params, [USER_ID]);
      return { rows: [] };
    },
  } as unknown as Pool;

  await findCompletedOnboardingForAuthIdentity(
    {
      id: USER_ID,
      email: "founder@example.com",
      email_verified: false,
    },
    pool,
    {
      async reconcileWorkspaceMemberships() {
        reconciled = true;
        return [];
      },
    },
  );

  assert.equal(reconciled, false);
});
