import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import {
  decryptCredentials,
  encryptCredentials,
} from "../core/substrate/auth/credentials.ts";
import {
  createOutlookSender,
  createFixedIntentClassifier,
  handleBounce,
  handleInboundEmail,
  projectOutlookAuthorization,
  registerEmailIngressProjectors,
} from "../core/channels/email/index.ts";

interface Seeded {
  workspace_id: string;
  channel_account_id: string;
  conversation_id: string;
  outbound_message_id: string;
  outbound_external_id: string;
}

async function seedOutbound(pool: Pool, kind: "email_domain" | "oauth_outlook" = "email_domain"): Promise<Seeded> {
  const workspace_id = randomUUID();
  const rep_id = randomUUID();
  const person_id = randomUUID();
  const channel_account_id = randomUUID();
  const conversation_id = randomUUID();
  const outbound_message_id = randomUUID();
  const outbound_external_id = `provider-${randomUUID()}`;
  await pool.query(`insert into workspaces (id, slug, name) values ($1, $2, 'ws')`, [
    workspace_id,
    `ws-${workspace_id.slice(0, 8)}`,
  ]);
  await pool.query(
    `insert into reps (id, workspace_id, name, role, status, persona)
     values ($1, $2, 'Maya', 'sdr', 'active', '{}'::jsonb)`,
    [rep_id, workspace_id],
  );
  await pool.query(
    `insert into graph_persons (id, workspace_id, full_name, emails)
     values ($1, $2, 'Anne', array['anne@example.com']::citext[])`,
    [person_id, workspace_id],
  );
  await pool.query(
    `insert into channel_accounts (id, workspace_id, kind, display_name, status)
     values ($1, $2, $3, 'inbox', 'connected')`,
    [channel_account_id, workspace_id, kind],
  );
  await pool.query(
    `insert into conversations (
       id, workspace_id, rep_id, counterparty_person_id, status, last_activity_at
     ) values ($1, $2, $3, $4, 'awaiting_them', now())`,
    [conversation_id, workspace_id, rep_id, person_id],
  );
  await pool.query(
    `insert into messages (
       id, workspace_id, conversation_id, channel, direction, status,
       subject, body, external_id, sent_at, channel_account_id
     ) values ($1, $2, $3, 'email', 'outbound', 'sent',
       'Series A', 'Congratulations.', $4, now(), $5)`,
    [
      outbound_message_id,
      workspace_id,
      conversation_id,
      outbound_external_id,
      channel_account_id,
    ],
  );
  return {
    workspace_id,
    channel_account_id,
    conversation_id,
    outbound_message_id,
    outbound_external_id,
  };
}

test("email ingress projector: canonical inbound event materializes reply and outcome", async (t) => {
  const fx = await setupPg("email_ingress_reply");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedOutbound(fx.pool);
    await registerEmailIngressProjectors({
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("positive", 0.95),
    });
    const inbound = {
      external_id: "inbound-1",
      in_reply_to: seeded.outbound_external_id,
      from: { email: "anne@example.com" },
      subject: "Re: Series A",
      body_text: "Happy to chat.",
      received_at: new Date().toISOString(),
      channel_account_id: seeded.channel_account_id,
    };
    const ingress = await bus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "email.inbound.received",
      source: "webhook",
      idempotency_key: "sns:reply-1",
      payload: inbound,
    });

    await until(async () => {
      const { rows } = await fx.pool.query<{ n: string }>(
        `select count(*)::text as n from outcomes
          where workspace_id = $1 and kind = 'positive_reply'`,
        [seeded.workspace_id],
      );
      return Number(rows[0].n) === 1;
    });
    const { rows } = await fx.pool.query<{ intent_class: string }>(
      `select intent_class from messages
        where workspace_id = $1 and external_id = 'inbound-1'`,
      [seeded.workspace_id],
    );
    assert.equal(rows[0].intent_class, "positive");

    await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("positive", 0.95),
        ingress_event_id: ingress.id,
      },
      { workspace_id: seeded.workspace_id, ...inbound },
    );
    const { rows: outcomeRows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from outcomes
        where workspace_id = $1 and kind = 'positive_reply'`,
      [seeded.workspace_id],
    );
    assert.equal(Number(outcomeRows[0].n), 1);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("email ingress projector: bounce event materializes suppression outcome", async (t) => {
  const fx = await setupPg("email_ingress_bounce");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedOutbound(fx.pool);
    await registerEmailIngressProjectors({
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("neutral", 1),
    });
    const ingress = await bus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "email.bounce.received",
      source: "webhook",
      idempotency_key: "sns:bounce-1",
      payload: {
        external_id: seeded.outbound_external_id,
        recipient: "anne@example.com",
        bounce_type: "hard",
        detail: "mailbox not found",
      },
    });

    await until(async () => {
      const { rows } = await fx.pool.query<{ n: string }>(
        `select count(*)::text as n from outcomes
          where workspace_id = $1
            and attributed_message_id = $2
            and kind = 'do_not_contact'`,
        [seeded.workspace_id, seeded.outbound_message_id],
      );
      return Number(rows[0].n) === 1;
    });
    const { rows: messageRows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from messages where id = $1`,
      [seeded.outbound_message_id],
    );
    assert.equal(messageRows[0].status, "bounced");
    const { rows } = await fx.pool.query<{ kind: string }>(
      `select kind::text as kind from outcomes
        where workspace_id = $1 and attributed_message_id = $2`,
      [seeded.workspace_id, seeded.outbound_message_id],
    );
    assert.equal(rows[0].kind, "do_not_contact");

    await handleBounce(
      fx.pool,
      bus,
      {
        workspace_id: seeded.workspace_id,
        external_id: seeded.outbound_external_id,
        recipient: "anne@example.com",
        bounce_type: "hard",
        detail: "mailbox not found",
      },
      { ingress_event_id: ingress.id },
    );
    const { rows: outcomeRows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from outcomes
        where workspace_id = $1
          and attributed_message_id = $2
          and kind = 'do_not_contact'`,
      [seeded.workspace_id, seeded.outbound_message_id],
    );
    assert.equal(Number(outcomeRows[0].n), 1);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("email ingress projector: Outlook notification fetch happens after enqueue", async (t) => {
  const fx = await setupPg("email_ingress_outlook");
  if (!fx) return t.skip("DATABASE_URL not set");
  const priorKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedOutbound(fx.pool, "oauth_outlook");
    const credentials = encryptCredentials(
      { access_token: "graph-token" },
      {
        workspace_id: seeded.workspace_id,
        channel_account_id: seeded.channel_account_id,
      },
    );
    await fx.pool.query(`update channel_accounts set credentials = $2 where id = $1`, [
      seeded.channel_account_id,
      JSON.stringify(credentials),
    ]);
    const fetchedAuthorization: string[] = [];
    let classified = false;
    await bus.subscribe("reply.classified", () => {
      classified = true;
    });
    await registerEmailIngressProjectors({
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("neutral", 0.9),
      outlookAccessTokens: {
        async getAccessToken(channel_account_id) {
          assert.equal(channel_account_id, seeded.channel_account_id);
          return "fresh-graph-token";
        },
      },
      fetchImpl: async (_url, init) => {
        fetchedAuthorization.push(String(init?.headers && (init.headers as Record<string, string>).Authorization));
        return new Response(
          JSON.stringify({
            id: "graph-message-id",
            internetMessageId: "outlook-in-1",
            subject: "Re: Series A",
            body: { contentType: "text", content: "Got it." },
            receivedDateTime: new Date().toISOString(),
            from: { emailAddress: { address: "anne@example.com" } },
            internetMessageHeaders: [
              { name: "In-Reply-To", value: `<${seeded.outbound_external_id}>` },
            ],
          }),
          { status: 200 },
        );
      },
    });
    await bus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "email.outlook.notification.received",
      source: "webhook",
      payload: {
        channel_account_id: seeded.channel_account_id,
        subscription_id: "graph-sub-1",
        resource_id: "graph-message-id",
      },
    });

    await until(async () => {
      const { rows } = await fx.pool.query<{ n: string }>(
        `select count(*)::text as n from messages where external_id = 'outlook-in-1'`,
      );
      return Number(rows[0].n) === 1 && classified;
    });
    assert.deepEqual(fetchedAuthorization, ["Bearer fresh-graph-token"]);
  } finally {
    if (priorKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = priorKey;
    await bus.close();
    await fx.close();
  }
});

test("email ingress projector: encrypted Outlook authorization creates account then starts repair", async (t) => {
  const fx = await setupPg("email_ingress_outlook_auth");
  if (!fx) return t.skip("DATABASE_URL not set");
  const priorKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  const repairs: Array<{ workspace_id: string; channel_account_id: string }> = [];
  try {
    const workspace_id = randomUUID();
    const channel_account_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, 'ws')`,
      [workspace_id, `ws-${workspace_id.slice(0, 8)}`],
    );
    const credentials = encryptCredentials(
      {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_at: "2026-05-28T00:00:00.000Z",
      },
      { workspace_id, channel_account_id },
    );
    await registerEmailIngressProjectors({
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("neutral", 1),
      outlookSubscriptionRepair: {
        async start(input) {
          repairs.push(input);
        },
      },
    });

    await bus.publish({
      workspace_id,
      event_type: "email.outlook.authorization.received",
      source: "user",
      idempotency_key: `outlook-authorization:${channel_account_id}`,
      payload: {
        channel_account_id,
        display_name: "founder@example.com",
        daily_cap: 25,
        encrypted_credentials: credentials,
        ms_user_id: "ms-user-1",
      },
    });

    await until(async () => repairs.length === 1);
    const { rows } = await fx.pool.query<{
      display_name: string;
      credentials: unknown;
      properties: { ms_user_id: string };
    }>(
      `select display_name, credentials, properties
         from channel_accounts
        where workspace_id = $1 and id = $2`,
      [workspace_id, channel_account_id],
    );
    assert.equal(rows[0].display_name, "founder@example.com");
    assert.deepEqual(rows[0].credentials, credentials);
    assert.equal(rows[0].properties.ms_user_id, "ms-user-1");
    assert.deepEqual(repairs, [{ workspace_id, channel_account_id }]);

    const { rows: connected } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n
         from events
        where workspace_id = $1 and event_type = 'channel.account.connected'`,
      [workspace_id],
    );
    assert.equal(Number(connected[0].n), 1);

    await projectOutlookAuthorization(fx.pool, workspace_id, {
      channel_account_id,
      display_name: "founder@example.com",
      daily_cap: 25,
      encrypted_credentials: credentials,
      ms_user_id: "ms-user-1",
    });
    const { rows: count } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from channel_accounts where id = $1`,
      [channel_account_id],
    );
    assert.equal(Number(count[0].n), 1);
  } finally {
    if (priorKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = priorKey;
    await bus.close();
    await fx.close();
  }
});

test("Outlook refresh: publishes encrypted credentials once under concurrent token requests", async (t) => {
  const fx = await setupPg("email_outlook_refresh");
  if (!fx) return t.skip("DATABASE_URL not set");
  const priorKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedOutbound(fx.pool, "oauth_outlook");
    const initial = encryptCredentials(
      {
        access_token: "expired-access",
        refresh_token: "refresh-before",
        expires_at: "2020-01-01T00:00:00.000Z",
      },
      {
        workspace_id: seeded.workspace_id,
        channel_account_id: seeded.channel_account_id,
      },
    );
    await fx.pool.query(`update channel_accounts set credentials = $2 where id = $1`, [
      seeded.channel_account_id,
      JSON.stringify(initial),
    ]);
    await registerEmailIngressProjectors({
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("neutral", 1),
    });
    let refreshCalls = 0;
    const refreshBodies: string[] = [];
    const outlook = createOutlookSender({
      pool: fx.pool,
      bus,
      clientId: "microsoft-client",
      clientSecret: "microsoft-secret",
      fetchImpl: async (_url, init) => {
        refreshCalls += 1;
        refreshBodies.push(String(init?.body ?? ""));
        return new Response(
          JSON.stringify({
            access_token: "fresh-access",
            refresh_token: "refresh-after",
            expires_in: 3600,
          }),
          { status: 200 },
        );
      },
    });

    const tokens = await Promise.all([
      outlook.getAccessToken(seeded.channel_account_id),
      outlook.getAccessToken(seeded.channel_account_id),
    ]);
    assert.deepEqual(tokens, ["fresh-access", "fresh-access"]);
    assert.equal(refreshCalls, 1);
    assert.equal(
      new URLSearchParams(refreshBodies[0]).get("scope"),
      "offline_access https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read",
    );
    assert.equal(refreshBodies[0].includes("Calendars.ReadBasic"), false);

    await until(async () => {
      const { rows } = await fx.pool.query<{ credentials: unknown }>(
        `select credentials from channel_accounts where id = $1`,
        [seeded.channel_account_id],
      );
      const current = decryptCredentials<{ access_token: string }>(
        rows[0].credentials,
        {
          workspace_id: seeded.workspace_id,
          channel_account_id: seeded.channel_account_id,
        },
      );
      return current.access_token === "fresh-access";
    });
    const { rows: eventRows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n
         from events
        where workspace_id = $1
          and event_type = 'email.outlook.credentials.refreshed'`,
      [seeded.workspace_id],
    );
    assert.equal(Number(eventRows[0].n), 1);
  } finally {
    if (priorKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = priorKey;
    await bus.close();
    await fx.close();
  }
});

test("Outlook refresh: a revoked grant projects needs_reauth and stops repeated refresh", async (t) => {
  const fx = await setupPg("email_outlook_reauth");
  if (!fx) return t.skip("DATABASE_URL not set");
  const priorKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedOutbound(fx.pool, "oauth_outlook");
    const initial = encryptCredentials(
      {
        access_token: "expired-access",
        refresh_token: "revoked-refresh",
        expires_at: "2020-01-01T00:00:00.000Z",
      },
      {
        workspace_id: seeded.workspace_id,
        channel_account_id: seeded.channel_account_id,
      },
    );
    await fx.pool.query(`update channel_accounts set credentials = $2 where id = $1`, [
      seeded.channel_account_id,
      JSON.stringify(initial),
    ]);
    await registerEmailIngressProjectors({
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("neutral", 1),
    });
    let refreshCalls = 0;
    const outlook = createOutlookSender({
      pool: fx.pool,
      bus,
      clientId: "microsoft-client",
      clientSecret: "microsoft-secret",
      fetchImpl: async () => {
        refreshCalls += 1;
        return new Response("invalid_grant", { status: 400 });
      },
    });

    await assert.rejects(
      outlook.getAccessToken(seeded.channel_account_id),
      /Outlook token refresh failed \(400\)/,
    );
    await until(async () => {
      const { rows } = await fx.pool.query<{ status: string }>(
        `select status::text as status from channel_accounts where id = $1`,
        [seeded.channel_account_id],
      );
      return rows[0].status === "needs_reauth";
    });
    await assert.rejects(
      outlook.getAccessToken(seeded.channel_account_id),
      /requires Outlook reauthorization/,
    );
    assert.equal(refreshCalls, 1);

    const { rows: eventRows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n
         from events
        where workspace_id = $1
          and event_type = 'email.outlook.reauthorization.required'`,
      [seeded.workspace_id],
    );
    assert.equal(Number(eventRows[0].n), 1);
  } finally {
    if (priorKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    else process.env.CREDENTIALS_ENCRYPTION_KEY = priorKey;
    await bus.close();
    await fx.close();
  }
});
