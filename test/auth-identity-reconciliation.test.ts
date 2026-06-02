import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  reconcileWorkspaceMembershipsForAuthIdentity,
} from "../core/product/app.ts";
import type { PublishedEvent } from "../core/substrate/events/index.ts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

test("post-auth reconciliation seats same-email verified users into existing workspaces", async () => {
  const applied: PublishedEvent[] = [];
  const published: Array<{
    workspace_id: string;
    event_type: string;
    idempotency_key?: string;
    payload: Record<string, unknown>;
  }> = [];
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /join auth\.users member_user/);
      assert.doesNotMatch(sql, /member_user\.email_confirmed_at is not null/);
      assert.match(sql, /current_member\.user_id = \$1/);
      assert.deepEqual(params, [USER_ID, "founder@example.com"]);
      return {
        rows: [
          {
            workspace_id: WORKSPACE_ID,
            role: "owner",
          },
        ],
      };
    },
  } as unknown as Pool;

  const reconciled = await reconcileWorkspaceMembershipsForAuthIdentity(
    {
      user_id: USER_ID,
      email: "Founder@Example.COM",
      email_verified: true,
    },
    {
      pool,
      bus: {
        async publish(event) {
          published.push(event);
          return {
            id: "33333333-3333-4333-8333-333333333333",
            schema_version: 1,
            occurred_at: new Date("2026-06-02T00:00:00.000Z"),
            source: event.source ?? "system",
            producer_ref: event.producer_ref ?? null,
            correlation_id: event.correlation_id ?? null,
            causation_id: event.causation_id ?? null,
            ...event,
          } as PublishedEvent;
        },
      },
      async applyMembership(event) {
        applied.push(event);
      },
    },
  );

  assert.deepEqual(reconciled, [{ workspace_id: WORKSPACE_ID, role: "owner" }]);
  assert.equal(published.length, 1);
  assert.equal(published[0]?.event_type, "workspace.member.accepted");
  assert.equal(
    published[0]?.idempotency_key,
    `auth.identity.reconciled:${WORKSPACE_ID}:${USER_ID}:owner`,
  );
  assert.deepEqual(published[0]?.payload, {
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    role: "owner",
  });
  assert.equal(applied.length, 1);
});

test("post-auth reconciliation can recover workspaces from unconfirmed legacy identities", async () => {
  const published: Array<{ event_type: string; payload: Record<string, unknown> }> = [];
  const pool = {
    async query(sql: string, params: unknown[]) {
      assert.match(sql, /lower\(member_user\.email\) = \$2/);
      assert.doesNotMatch(sql, /member_user\.email_confirmed_at is not null/);
      assert.deepEqual(params, [USER_ID, "founder@example.com"]);
      return {
        rows: [
          {
            workspace_id: WORKSPACE_ID,
            role: "owner",
          },
        ],
      };
    },
  } as unknown as Pool;

  const reconciled = await reconcileWorkspaceMembershipsForAuthIdentity(
    {
      user_id: USER_ID,
      email: "founder@example.com",
      email_verified: true,
    },
    {
      pool,
      bus: {
        async publish(event) {
          published.push(event);
          return {
            id: "44444444-4444-4444-8444-444444444444",
            schema_version: 1,
            occurred_at: new Date("2026-06-02T00:00:00.000Z"),
            source: event.source ?? "system",
            producer_ref: event.producer_ref ?? null,
            correlation_id: event.correlation_id ?? null,
            causation_id: event.causation_id ?? null,
            ...event,
          } as PublishedEvent;
        },
      },
      async applyMembership() {},
    },
  );

  assert.deepEqual(reconciled, [{ workspace_id: WORKSPACE_ID, role: "owner" }]);
  assert.equal(published[0]?.event_type, "workspace.member.accepted");
  assert.deepEqual(published[0]?.payload, {
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    role: "owner",
  });
});

test("post-auth reconciliation ignores unverified email identities", async () => {
  let queried = false;
  const pool = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  } as unknown as Pool;

  const reconciled = await reconcileWorkspaceMembershipsForAuthIdentity(
    {
      user_id: USER_ID,
      email: "founder@example.com",
      email_verified: false,
    },
    {
      pool,
      bus: {
        async publish(event) {
          throw new Error(`should not publish ${event.event_type}`);
        },
      },
    },
  );

  assert.deepEqual(reconciled, []);
  assert.equal(queried, false);
});
