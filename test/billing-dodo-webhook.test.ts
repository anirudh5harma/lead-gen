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

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    this.queries.push({ sql, params });
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
  assert.equal(bus.published.length, 1);
  assert.equal(bus.published[0]?.event_type, "workspace.billing.subscription.synced");
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
});
