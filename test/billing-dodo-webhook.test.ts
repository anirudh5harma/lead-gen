import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Pool, QueryResult } from "pg";

process.env.DODO_PRODUCT_LAUNCH_MONTHLY = "prod_pro_monthly";
process.env.DODO_PRODUCT_LAUNCH_ANNUAL = "prod_pro_annual";

const { createInMemoryEventBus } = await import(
  "../core/substrate/events/adapters/in-memory.ts"
);
const { handleDodoWebhookEvent } = await import(
  "../core/billing/subscriptions.ts"
);

class FakePool {
  queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  entitlementReads = 0;

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.queries.push({ sql, params });
    if (
      /select subscription_status, subscription_renews_at/i.test(sql) ||
      /select trial_credits_remaining, trial_credits_total,\s*subscription_status, subscription_renews_at/i
        .test(sql)
    ) {
      this.entitlementReads += 1;
      return {
        command: "SELECT",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [this.entitlementReads === 1
          ? {
            trial_credits_remaining: 15,
            trial_credits_total: 15,
            subscription_status: "inactive",
            subscription_renews_at: null,
          }
          : {
            trial_credits_remaining: 15,
            trial_credits_total: 15,
            subscription_status: "active",
            subscription_renews_at: new Date("2026-07-20T00:00:00.000Z"),
          }],
      };
    }
    if (/select count\(\*\)::text as resumed from resumed/i.test(sql)) {
      return {
        command: "UPDATE",
        rowCount: 1,
        oid: 0,
        fields: [],
        rows: [{ resumed: "2" }],
      };
    }
    return {
      command: "UPDATE",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [],
    };
  }
}

test("Dodo subscription.active publishes and projects Pro workspace billing state", async () => {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const pool = new FakePool();
  const bus = createInMemoryEventBus();

  const result = await handleDodoWebhookEvent(
    pool as unknown as Pool,
    bus,
    {
      type: "subscription.active",
      timestamp: "2026-06-20T00:00:00.000Z",
      data: {
        subscription_id: "sub_123",
        product_id: "prod_pro_monthly",
        status: "active",
        next_billing_date: "2026-07-20T00:00:00.000Z",
        previous_billing_date: "2026-06-20T00:00:00.000Z",
        customer: {
          customer_id: "cus_123",
          email: "buyer@example.com",
        },
        metadata: {
          purchase_type: "subscription",
          plan: "pro",
          period: "monthly",
          user_id: userId,
          workspace_id: workspaceId,
        },
      },
    },
    { webhookId: "evt_123" },
  );

  assert.equal(result.handled, true);
  // subscription.synced, then outreach.resumed (Pro activation resumes any
  // trial-frozen outreach).
  assert.equal(bus.published.length, 2);
  assert.equal(bus.published[0]?.event_type, "workspace.billing.subscription.synced");
  assert.equal(bus.published[1]?.event_type, "workspace.outreach.resumed");
  assert.deepEqual(bus.published[1]?.payload, {
    workspace_id: workspaceId,
    reason: "subscription_activated",
    resumed_at: "2026-06-20T00:00:00.000Z",
    resumed_message_count: 2,
    subscription_status: "active",
    renews_at: "2026-07-20T00:00:00.000Z",
  });
  assert.deepEqual(bus.published[0]?.payload, {
    workspace_id: workspaceId,
    provider: "dodo",
    plan: "pro",
    status: "active",
    period: "monthly",
    provider_customer_id: "cus_123",
    provider_subscription_id: "sub_123",
    provider_product_id: "prod_pro_monthly",
    current_period_start_at: "2026-06-20T00:00:00.000Z",
    renews_at: "2026-07-20T00:00:00.000Z",
    canceled_at: null,
    webhook_event_type: "subscription.active",
    raw_status: "active",
  });

  const update = pool.queries.find((q) => /update workspaces/i.test(q.sql));
  assert.ok(update, "workspace projection update should run");
  assert.deepEqual(update.params, [
    workspaceId,
    "pro",
    "active",
    "monthly",
    "sub_123",
    "prod_pro_monthly",
    "cus_123",
    "2026-06-20T00:00:00.000Z",
    "2026-07-20T00:00:00.000Z",
    null,
    "2026-06-20T00:00:00.000Z",
  ]);

  const resumeUpdate = pool.queries.find((q) =>
    /update messages/i.test(q.sql) && /trial_frozen/i.test(q.sql)
  );
  assert.ok(resumeUpdate, "held trial-frozen messages should be marked for immediate retry");
});
