import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  createOutlookSubscriptionRepairWorkflow,
  isOutlookReauthorizationRequiredError,
  loadOutlookSubscription,
  type OutlookAccessTokenProvider,
} from "../core/channels/email/index.ts";
import { createInMemoryEventBus } from "../core/substrate/events/index.ts";
import type { RunContext } from "../core/substrate/workflows/index.ts";
import { setupPg } from "./_pg.ts";

async function seedOutlookAccount(pool: Pool): Promise<{
  workspace_id: string;
  channel_account_id: string;
}> {
  const workspace_id = randomUUID();
  const channel_account_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `outlook-${workspace_id}`, "Outlook workflow"],
  );
  await pool.query(
    `insert into channel_accounts (id, workspace_id, kind, display_name, status)
     values ($1, $2, 'oauth_outlook', 'founder@example.com', 'connected')`,
    [channel_account_id, workspace_id],
  );
  return { workspace_id, channel_account_id };
}

function accessTokens(): OutlookAccessTokenProvider {
  return {
    async getAccessToken() {
      return "access-token";
    },
  };
}

function context(workspace_id: string, bus: ReturnType<typeof createInMemoryEventBus>): RunContext {
  return {
    run_id: randomUUID(),
    workspace_id,
    correlation_id: randomUUID(),
    step: async (_name, fn) => fn(),
    sleep: async () => undefined,
    awaitEvent: async () => {
      throw new Error("not used");
    },
    requestApproval: async () => {
      throw new Error("not used");
    },
    publish: async (event_type, payload) => {
      await bus.publish({
        workspace_id,
        event_type,
        source: "system",
        payload,
      });
    },
  };
}

test("Outlook lifecycle reauthorization repair uses one silent renewal call", async () => {
  const workspace_id = randomUUID();
  const channel_account_id = randomUUID();
  const existing = {
    id: "subscription-existing",
    resource: "/me/messages",
    expirationDateTime: "2026-05-28T00:00:00.000Z",
    clientState: "secret",
    notificationUrl: "https://app.example/api/webhooks/outlook",
    lifecycleNotificationUrl: "https://app.example/api/webhooks/outlook",
    recorded_at: "2026-05-27T00:00:00.000Z",
  };
  let persisted: unknown;
  const pool = {
    async query(sql: string, params: unknown[]) {
      if (sql.includes("select id, workspace_id")) {
        assert.equal(params[0], workspace_id);
        assert.equal(params[1], channel_account_id);
        return { rows: [{ id: channel_account_id, workspace_id }] };
      }
      if (sql.includes("select properties from channel_accounts")) {
        return { rows: [{ properties: { outlook_subscription: existing } }] };
      }
      if (sql.includes("jsonb_build_object('outlook_subscription'")) {
        persisted = JSON.parse(params[2] as string);
        return { rowCount: 1, rows: [] };
      }
      if (sql.includes("last_error")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  } as unknown as Pool;
  const bus = createInMemoryEventBus();
  const calls: Array<{ method: string | undefined; url: string }> = [];
  const workflow = createOutlookSubscriptionRepairWorkflow({
    pool,
    accessTokens: accessTokens(),
    notificationUrl: "https://app.example/api/webhooks/outlook",
    fetchImpl: async (url, init) => {
      calls.push({ method: init?.method, url: String(url) });
      if (String(url).endsWith("/reauthorize")) {
        throw new Error("unexpected Graph subscription reauthorize call");
      }
      return new Response(
        JSON.stringify({ expirationDateTime: "2026-06-02T00:00:00.000Z" }),
        { status: 200 },
      );
    },
  });

  const result = await workflow.run(
    {
      workspace_id,
      channel_account_id,
      lifecycle_event: "reauthorizationRequired",
    },
    context(workspace_id, bus),
  );

  assert.deepEqual(
    calls.map((c) => [c.method, c.url.endsWith("/reauthorize")]),
    [["PATCH", false]],
  );
  assert.equal(result.failed, 0);
  assert.equal(result.subscriptions_renewed, 1);
  assert.equal(
    (persisted as { expirationDateTime?: string } | undefined)?.expirationDateTime,
    "2026-06-02T00:00:00.000Z",
  );
  assert.equal(
    (bus.published[0].payload as { operation: string }).operation,
    "renewed",
  );
});

test("Outlook repair workflow creates and projects a missing Graph subscription", async (t) => {
  const fx = await setupPg("outlook_subscription_create");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const account = await seedOutlookAccount(fx.pool);
    const bus = createInMemoryEventBus();
    const calls: RequestInit[] = [];
    const workflow = createOutlookSubscriptionRepairWorkflow({
      pool: fx.pool,
      accessTokens: accessTokens(),
      notificationUrl: "https://app.example/api/webhooks/outlook",
      fetchImpl: async (_url, init) => {
        calls.push(init ?? {});
        return new Response(
          JSON.stringify({
            id: "subscription-created",
            resource: "/me/messages",
            expirationDateTime: "2026-06-01T00:00:00.000Z",
          }),
          { status: 201 },
        );
      },
    });

    const result = await workflow.run(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.channel_account_id,
      },
      context(account.workspace_id, bus),
    );

    assert.deepEqual(result, {
      accounts_checked: 1,
      subscriptions_created: 1,
      subscriptions_renewed: 0,
      subscriptions_migrated: 0,
      failed: 0,
    });
    assert.equal(calls[0].method, "POST");
    // Subscription POST body includes lifecycleNotificationUrl so new
    // subscriptions enroll in lifecycle events automatically.
    const body = JSON.parse(calls[0].body as string);
    assert.equal(
      body.lifecycleNotificationUrl,
      "https://app.example/api/webhooks/outlook",
    );
    const requestedExpirationMs = new Date(body.expirationDateTime).getTime();
    assert.ok(
      requestedExpirationMs - Date.now() > 6 * 24 * 60 * 60 * 1000,
      "subscription renewal should be a quiet backend task near Graph's max window",
    );
    assert.ok(
      requestedExpirationMs - Date.now() <= 7 * 24 * 60 * 60 * 1000,
      "subscription expiration must stay under Graph's Outlook subscription max",
    );
    const subscription = await loadOutlookSubscription(
      fx.pool,
      account.workspace_id,
      account.channel_account_id,
    );
    assert.equal(subscription?.id, "subscription-created");
    assert.equal(bus.published[0].event_type, "email.outlook.subscription.updated");
    assert.deepEqual(bus.published[0].payload, {
      channel_account_id: account.channel_account_id,
      subscription_id: "subscription-created",
      operation: "created",
      expires_at: "2026-06-01T00:00:00.000Z",
    });
  } finally {
    await fx.close();
  }
});

test("Outlook repair workflow renews an existing subscription for a requested account", async (t) => {
  const fx = await setupPg("outlook_subscription_renew");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const account = await seedOutlookAccount(fx.pool);
    await fx.pool.query(
      `update channel_accounts
          set properties = jsonb_build_object('outlook_subscription', $3::jsonb)
        where workspace_id = $1 and id = $2`,
      [
        account.workspace_id,
        account.channel_account_id,
        JSON.stringify({
          id: "subscription-existing",
          resource: "/me/messages",
          expirationDateTime: "2026-05-28T00:00:00.000Z",
          clientState: "secret",
          notificationUrl: "https://app.example/api/webhooks/outlook",
          lifecycleNotificationUrl: "https://app.example/api/webhooks/outlook",
          recorded_at: "2026-05-27T00:00:00.000Z",
        }),
      ],
    );
    const bus = createInMemoryEventBus();
    let method: string | undefined;
    const workflow = createOutlookSubscriptionRepairWorkflow({
      pool: fx.pool,
      accessTokens: accessTokens(),
      notificationUrl: "https://app.example/api/webhooks/outlook",
      fetchImpl: async (_url, init) => {
        method = init?.method;
        return new Response(
          JSON.stringify({ expirationDateTime: "2026-06-02T00:00:00.000Z" }),
          { status: 200 },
        );
      },
    });

    const result = await workflow.run(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.channel_account_id,
      },
      context(account.workspace_id, bus),
    );

    assert.equal(method, "PATCH");
    assert.equal(result.subscriptions_renewed, 1);
    const subscription = await loadOutlookSubscription(
      fx.pool,
      account.workspace_id,
      account.channel_account_id,
    );
    assert.equal(subscription?.expirationDateTime, "2026-06-02T00:00:00.000Z");
    assert.equal(
      (bus.published[0].payload as { operation: string }).operation,
      "renewed",
    );
  } finally {
    await fx.close();
  }
});

test("Outlook repair workflow renews once after lifecycle reauthorization notification", async (t) => {
  const fx = await setupPg("outlook_subscription_lifecycle_reauth");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const account = await seedOutlookAccount(fx.pool);
    await fx.pool.query(
      `update channel_accounts
          set properties = jsonb_build_object('outlook_subscription', $3::jsonb)
        where workspace_id = $1 and id = $2`,
      [
        account.workspace_id,
        account.channel_account_id,
        JSON.stringify({
          id: "subscription-existing",
          resource: "/me/messages",
          expirationDateTime: "2026-05-28T00:00:00.000Z",
          clientState: "secret",
          notificationUrl: "https://app.example/api/webhooks/outlook",
          lifecycleNotificationUrl: "https://app.example/api/webhooks/outlook",
          recorded_at: "2026-05-27T00:00:00.000Z",
        }),
      ],
    );
    const bus = createInMemoryEventBus();
    const calls: Array<{ method: string | undefined; url: string }> = [];
    const workflow = createOutlookSubscriptionRepairWorkflow({
      pool: fx.pool,
      accessTokens: accessTokens(),
      notificationUrl: "https://app.example/api/webhooks/outlook",
      fetchImpl: async (url, init) => {
        calls.push({ method: init?.method, url: String(url) });
        return new Response(
          JSON.stringify({ expirationDateTime: "2026-06-02T00:00:00.000Z" }),
          { status: 200 },
        );
      },
    });

    const result = await workflow.run(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.channel_account_id,
        lifecycle_event: "reauthorizationRequired",
      },
      context(account.workspace_id, bus),
    );

    assert.deepEqual(
      calls.map((c) => [c.method, c.url.endsWith("/reauthorize")]),
      [["PATCH", false]],
    );
    assert.equal(result.subscriptions_renewed, 1);
    assert.equal(
      (bus.published[0].payload as { operation: string }).operation,
      "renewed",
    );
  } finally {
    await fx.close();
  }
});

test("Outlook repair workflow migrates a legacy subscription (no lifecycleNotificationUrl) via delete + recreate", async (t) => {
  const fx = await setupPg("outlook_subscription_migrate");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const account = await seedOutlookAccount(fx.pool);
    // Legacy subscription persisted before lifecycleNotificationUrl was wired.
    await fx.pool.query(
      `update channel_accounts
          set properties = jsonb_build_object('outlook_subscription', $3::jsonb)
        where workspace_id = $1 and id = $2`,
      [
        account.workspace_id,
        account.channel_account_id,
        JSON.stringify({
          id: "subscription-legacy",
          resource: "/me/messages",
          expirationDateTime: "2026-05-28T00:00:00.000Z",
          clientState: "secret",
          notificationUrl: "https://app.example/api/webhooks/outlook",
          recorded_at: "2026-05-27T00:00:00.000Z",
        }),
      ],
    );
    const bus = createInMemoryEventBus();
    const calls: Array<{ method: string | undefined; url: string }> = [];
    const workflow = createOutlookSubscriptionRepairWorkflow({
      pool: fx.pool,
      accessTokens: accessTokens(),
      notificationUrl: "https://app.example/api/webhooks/outlook",
      fetchImpl: async (url, init) => {
        const u = url instanceof URL ? url.toString() : String(url);
        calls.push({ method: init?.method, url: u });
        if (init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return new Response(
          JSON.stringify({
            id: "subscription-fresh",
            resource: "/me/messages",
            expirationDateTime: "2026-06-01T00:00:00.000Z",
          }),
          { status: 201 },
        );
      },
    });

    const result = await workflow.run(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.channel_account_id,
      },
      context(account.workspace_id, bus),
    );

    assert.equal(result.subscriptions_migrated, 1);
    assert.equal(result.subscriptions_created, 0);
    assert.equal(result.subscriptions_renewed, 0);
    // The migration path always issues DELETE first, then POST.
    const methods = calls.map((c) => c.method);
    assert.deepEqual(methods, ["DELETE", "POST"]);
    const fresh = await loadOutlookSubscription(
      fx.pool,
      account.workspace_id,
      account.channel_account_id,
    );
    assert.equal(fresh?.id, "subscription-fresh");
    assert.equal(
      fresh?.lifecycleNotificationUrl,
      "https://app.example/api/webhooks/outlook",
    );
  } finally {
    await fx.close();
  }
});

test("Outlook repair workflow emits an account error and records repair failure", async (t) => {
  const fx = await setupPg("outlook_subscription_failure");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const account = await seedOutlookAccount(fx.pool);
    const bus = createInMemoryEventBus();
    const workflow = createOutlookSubscriptionRepairWorkflow({
      pool: fx.pool,
      accessTokens: accessTokens(),
      notificationUrl: "https://app.example/api/webhooks/outlook",
      fetchImpl: async () => new Response("Graph unavailable", { status: 503 }),
    });

    const result = await workflow.run(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.channel_account_id,
      },
      context(account.workspace_id, bus),
    );

    assert.equal(result.failed, 1);
    assert.equal(bus.published[0].event_type, "channel.account.errored");
    const { rows } = await fx.pool.query<{ last_error: { message: string } }>(
      `select last_error from channel_accounts where id = $1`,
      [account.channel_account_id],
    );
    assert.match(rows[0].last_error.message, /Graph unavailable/);
  } finally {
    await fx.close();
  }
});

test("Outlook repair workflow projects reauthorization failures as needs_reauth", async (t) => {
  const fx = await setupPg("outlook_subscription_reauth");
  if (!fx) return t.skip("DATABASE_URL not set");
  try {
    const account = await seedOutlookAccount(fx.pool);
    const bus = createInMemoryEventBus();
    const workflow = createOutlookSubscriptionRepairWorkflow({
      pool: fx.pool,
      accessTokens: {
        async getAccessToken() {
          throw new Error(
            `channel_account ${account.channel_account_id} requires Outlook reauthorization`,
          );
        },
      },
      notificationUrl: "https://app.example/api/webhooks/outlook",
      fetchImpl: async () => new Response("not reached", { status: 500 }),
    });

    const result = await workflow.run(
      {
        workspace_id: account.workspace_id,
        channel_account_id: account.channel_account_id,
      },
      context(account.workspace_id, bus),
    );

    assert.equal(result.failed, 1);
    assert.equal(
      bus.published[0].event_type,
      "email.outlook.reauthorization.required",
    );
    assert.equal(
      (bus.published[0].payload as { channel_account_id: string })
        .channel_account_id,
      account.channel_account_id,
    );
    const { rows } = await fx.pool.query<{
      status: string;
      last_error: { message: string };
    }>(
      `select status::text as status, last_error
         from channel_accounts
        where id = $1`,
      [account.channel_account_id],
    );
    assert.equal(rows[0].status, "needs_reauth");
    assert.match(rows[0].last_error.message, /requires Outlook reauthorization/);
  } finally {
    await fx.close();
  }
});

test("Outlook repair classifier keeps provider configuration errors out of needs_reauth", () => {
  assert.equal(
    isOutlookReauthorizationRequiredError(
      "Outlook token refresh failed (401): invalid_client AADSTS7000215: Invalid client secret provided.",
    ),
    false,
  );
  assert.equal(
    isOutlookReauthorizationRequiredError(
      "Outlook token refresh failed (400): invalid_grant AADSTS50173: The provided grant has expired due to it being revoked.",
    ),
    true,
  );
  assert.equal(
    isOutlookReauthorizationRequiredError(
      "Outlook token refresh failed (400): AADSTS700082: The refresh token has expired due to inactivity.",
    ),
    true,
  );
  assert.equal(
    isOutlookReauthorizationRequiredError(
      "Outlook subscription renew failed: AADSTS70000: transient provider condition",
    ),
    false,
  );
});
