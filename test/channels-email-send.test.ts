import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import { readEvalState } from "../core/channels/email/eval-gate.ts";
import {
  createEmailChannel,
  createMessageRow,
} from "../core/channels/email/send.ts";
import type { SesSender } from "../core/channels/email/adapters/ses.ts";
import type { OutlookSender } from "../core/channels/email/adapters/outlook.ts";
import { handleBounce } from "../core/channels/email/bounces.ts";

interface Seeded {
  workspace_id: string;
  rep_id: string;
  conversation_id: string;
  counterparty_person_id: string;
}

async function seed(
  pool: Pool,
  opts: { productReady?: boolean } = {},
): Promise<Seeded> {
  const productReady = opts.productReady ?? true;
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  if (productReady) {
    await pool.query(
      `insert into graph_companies (id, workspace_id, name, description, properties, provenance)
       values ($1, $2, 'Acme', 'Acme sells workflow software to GTM teams.', $3::jsonb, $4::jsonb)`,
      [
        randomUUID(),
        workspace_id,
        JSON.stringify({
          profile_role: "workspace_company",
          website_url: "https://acme.example",
          profile_source: "manual",
        }),
        JSON.stringify({ source: "manual" }),
      ],
    );
  }
  const counterparty_person_id = randomUUID();
  await pool.query(
    `insert into graph_persons (id, workspace_id, full_name, emails)
     values ($1, $2, 'Anne', array['anne@example.com']::citext[])`,
    [counterparty_person_id, workspace_id],
  );
  const rep_id = randomUUID();
  await pool.query(
    `insert into reps (id, workspace_id, name, role, status, persona)
     values ($1, $2, 'Maya', 'sdr', 'active', '{"voice":"warm"}'::jsonb)`,
    [rep_id, workspace_id],
  );
  const conversation_id = randomUUID();
  await pool.query(
    `insert into conversations (id, workspace_id, rep_id, counterparty_person_id, status)
     values ($1, $2, $3, $4, 'open')`,
    [conversation_id, workspace_id, rep_id, counterparty_person_id],
  );
  return { workspace_id, rep_id, conversation_id, counterparty_person_id };
}

async function seedOwnedDomainAccount(
  pool: Pool,
  workspace_id: string,
  cap = 50,
): Promise<{ channel_account_id: string; sending_domain_id: string }> {
  const channel_account_id = randomUUID();
  await pool.query(
    `insert into channel_accounts (id, workspace_id, kind, display_name, status, daily_cap)
     values ($1, $2, 'email_domain', 'hello', 'connected', $3)`,
    [channel_account_id, workspace_id, cap],
  );
  const sending_domain_id = randomUUID();
  await pool.query(
    `insert into sending_domains (
        id, workspace_id, channel_account_id, domain,
        spf_verified, dkim_verified, dmarc_verified,
        warmup_state, warmup_day, current_daily_cap, target_daily_cap
      ) values ($1, $2, $3, $4, true, true, true, 'warmed', 30, 50000, 50000)`,
    [sending_domain_id, workspace_id, channel_account_id, `send-${sending_domain_id.slice(0, 6)}.example.com`],
  );
  return { channel_account_id, sending_domain_id };
}

async function seedOutlookAccount(
  pool: Pool,
  workspace_id: string,
  cap = 5,
): Promise<{ channel_account_id: string }> {
  const channel_account_id = randomUUID();
  await pool.query(
    `insert into channel_accounts (
        id, workspace_id, kind, display_name, status, daily_cap, credentials
      ) values ($1, $2, 'oauth_outlook', 'anne@example.com', 'connected', $3, $4::jsonb)`,
    [
      channel_account_id,
      workspace_id,
      cap,
      JSON.stringify({
        access_token: "tok",
        refresh_token: "ref",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      }),
    ],
  );
  return { channel_account_id };
}

function spySes(): SesSender & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async send() {
      calls += 1;
      return { external_id: `ses-${calls}` };
    },
  };
}

function spyOutlook(): OutlookSender & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async send() {
      calls += 1;
      return { external_id: `outlook-${calls}` };
    },
  };
}

function fakeJudgePass(
  bus: ReturnType<typeof createInMemoryEventBus>,
  workspace_id: string,
  message_id: string,
): Promise<unknown> {
  return bus.publish({
    workspace_id,
    event_type: "draft.judged",
    source: "agent",
    payload: { message_id, eval_score: 0.9, passed: true },
  });
}

// ─── eval-gate enforcement ──────────────────────────────────────────────────

test("email channel: refuses to send without a passing draft.judged event", async (t) => {
  const fx = await setupPg("em_eval");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id, sending_domain_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
    );
    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Hi",
      body_text: "Just saying hi.",
    });

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({ pool: fx.pool, bus: pgBus, ses, outlook });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "owned_domain",
      sending_domain_id,
      draft: {
        to: { email: "anne@example.com", name: "Anne" },
        subject: "Hi",
        body_text: "Just saying hi.",
      },
    });
    assert.equal(result.status, "deferred");
    if (result.status === "deferred") assert.equal(result.reason, "not_judged");
    assert.equal(ses.calls, 0);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

test("email channel: defers on website_required when the workspace profile is incomplete", async (t) => {
  const fx = await setupPg("em_website_required");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool, { productReady: false });
    const { channel_account_id, sending_domain_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
    );
    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Hi",
      body_text: "Just saying hi.",
    });
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.judged",
      source: "agent",
      payload: { message_id, eval_score: 0.9, passed: true },
    });

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({ pool: fx.pool, bus: pgBus, ses, outlook });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "owned_domain",
      sending_domain_id,
      draft: {
        to: { email: "anne@example.com", name: "Anne" },
        subject: "Hi",
        body_text: "Just saying hi.",
      },
    });
    assert.equal(result.status, "deferred");
    if (result.status === "deferred") assert.equal(result.reason, "website_required");
    assert.equal(ses.calls, 0);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

test("email channel: defers when the latest draft.judged failed", async (t) => {
  const fx = await setupPg("em_fail");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id, sending_domain_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
    );
    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Hi",
      body_text: "Hello.",
    });
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.judged",
      source: "agent",
      payload: { message_id, eval_score: 0.2, passed: false },
    });
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.rejected",
      source: "agent",
      payload: { message_id, reason: "too generic" },
    });

    // Confirm the gate reader agrees.
    assert.equal(await readEvalState(fx.pool, seeded.workspace_id, message_id), "rejected");

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({ pool: fx.pool, bus: pgBus, ses, outlook });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "owned_domain",
      sending_domain_id,
      draft: {
        to: { email: "anne@example.com" },
        subject: "Hi",
        body_text: "Hello.",
      },
    });
    assert.equal(result.status, "deferred");
    if (result.status === "deferred") assert.equal(result.reason, "judge_failed");
    assert.equal(ses.calls, 0);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

// ─── happy paths ────────────────────────────────────────────────────────────

test("email channel: owned-domain happy path sends via SES and updates the messages row", async (t) => {
  const fx = await setupPg("em_ses_ok");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = createInMemoryEventBus();
  // Use Postgres bus for the events table write, in-memory bus for handler observations.
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id, sending_domain_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
    );
    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Saw your funding",
      body_text: "Congrats on the round.",
    });
    await fakeJudgePass(bus, seeded.workspace_id, message_id);
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.judged",
      source: "agent",
      payload: { message_id, eval_score: 0.9, passed: true },
    });

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({ pool: fx.pool, bus: pgBus, ses, outlook });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "owned_domain",
      sending_domain_id,
      draft: {
        to: { email: "anne@example.com", name: "Anne" },
        subject: "Saw your funding",
        body_text: "Congrats on the round.",
      },
    });
    assert.equal(result.status, "sent");
    if (result.status === "sent") {
      assert.match(result.external_id, /^ses-/);
      assert.equal(result.sub_channel, "owned_domain");
    }
    assert.equal(ses.calls, 1);
    assert.equal(outlook.calls, 0);

    // messages row reflects the send.
    const { rows } = await fx.pool.query<{
      status: string;
      external_id: string;
      sent_at: Date;
      channel_account_id: string;
    }>(
      `select status, external_id, sent_at, channel_account_id
         from messages where id = $1`,
      [message_id],
    );
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[0].channel_account_id, channel_account_id);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

test("email channel: outlook happy path sends via Microsoft Graph", async (t) => {
  const fx = await setupPg("em_outlook_ok");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id } = await seedOutlookAccount(fx.pool, seeded.workspace_id);
    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Quick note",
      body_text: "Hey.",
    });
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.judged",
      source: "agent",
      payload: { message_id, eval_score: 0.8, passed: true },
    });

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({ pool: fx.pool, bus: pgBus, ses, outlook });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "oauth_outlook",
      draft: {
        to: { email: "anne@example.com" },
        subject: "Quick note",
        body_text: "Hey.",
      },
    });
    assert.equal(result.status, "sent");
    if (result.status === "sent") assert.equal(result.sub_channel, "oauth_outlook");
    assert.equal(outlook.calls, 1);
    assert.equal(ses.calls, 0);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

// ─── caps + warmup integration ──────────────────────────────────────────────

test("email channel: defers on daily_cap_reached and refunds nothing", async (t) => {
  const fx = await setupPg("em_cap");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id, sending_domain_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
      0, // cap of 0 → every reserve fails
    );

    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Hi",
      body_text: "Hi.",
    });
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.judged",
      source: "agent",
      payload: { message_id, eval_score: 0.9, passed: true },
    });

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({ pool: fx.pool, bus: pgBus, ses, outlook });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "owned_domain",
      sending_domain_id,
      draft: {
        to: { email: "anne@example.com" },
        subject: "Hi",
        body_text: "Hi.",
      },
    });
    assert.equal(result.status, "deferred");
    if (result.status === "deferred") assert.equal(result.reason, "daily_cap_reached");
    assert.equal(ses.calls, 0);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

test("email channel: defers on frequency_cap_reached when same recipient was contacted recently", async (t) => {
  const fx = await setupPg("em_freq");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id, sending_domain_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
    );
    // Seed a recent outbound message to the same recipient.
    await fx.pool.query(
      `insert into messages (id, workspace_id, conversation_id, channel, direction, status, sent_at, channel_account_id)
       values ($1, $2, $3, 'email', 'outbound', 'sent', now() - interval '1 hour', $4)`,
      [randomUUID(), seeded.workspace_id, seeded.conversation_id, channel_account_id],
    );

    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "Hi again",
      body_text: "Following up.",
    });
    await pgBus.publish({
      workspace_id: seeded.workspace_id,
      event_type: "draft.judged",
      source: "agent",
      payload: { message_id, eval_score: 0.9, passed: true },
    });

    const ses = spySes();
    const outlook = spyOutlook();
    const channel = createEmailChannel({
      pool: fx.pool,
      bus: pgBus,
      ses,
      outlook,
      frequencyCap: { max_in_window: 1, window_hours: 24 },
    });

    const result = await channel.send({
      ...seeded,
      message_id,
      channel_account_id,
      sub_channel: "owned_domain",
      sending_domain_id,
      draft: {
        to: { email: "anne@example.com" },
        subject: "Hi again",
        body_text: "Following up.",
      },
    });
    assert.equal(result.status, "deferred");
    if (result.status === "deferred") assert.equal(result.reason, "frequency_cap_reached");
    assert.equal(ses.calls, 0);
  } finally {
    await pgBus.close();
    await fx.close();
  }
});

// ─── bounce handler ─────────────────────────────────────────────────────────

test("bounces: hard bounce updates the message, records a do_not_contact outcome, emits events", async (t) => {
  const fx = await setupPg("em_bounce");
  if (!fx) return t.skip("DATABASE_URL not set");
  const pgBus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seed(fx.pool);
    const { channel_account_id } = await seedOwnedDomainAccount(
      fx.pool,
      seeded.workspace_id,
    );
    const message_id = await createMessageRow(fx.pool, {
      workspace_id: seeded.workspace_id,
      conversation_id: seeded.conversation_id,
      channel: "email",
      subject: "x",
      body_text: "x",
    });
    const externalId = `ses-${randomUUID()}`;
    await fx.pool.query(
      `update messages set status = 'sent', external_id = $2, channel_account_id = $3
        where id = $1`,
      [message_id, externalId, channel_account_id],
    );

    const seenBounce: string[] = [];
    const seenOutcome: string[] = [];
    await pgBus.subscribe("message.bounced", (e) =>
      seenBounce.push((e.payload as { message_id: string }).message_id),
    );
    await pgBus.subscribe("outcome.recorded", (e) =>
      seenOutcome.push((e.payload as { kind: string }).kind),
    );

    await handleBounce(fx.pool, pgBus, {
      workspace_id: seeded.workspace_id,
      external_id: externalId,
      bounce_type: "hard",
      recipient: "anne@example.com",
      detail: "550 user unknown",
    });

    await until(() => seenBounce.length === 1 && seenOutcome.length === 1);
    assert.deepEqual(seenBounce, [message_id]);
    assert.deepEqual(seenOutcome, ["do_not_contact"]);

    const { rows } = await fx.pool.query<{ status: string; kind: string | null }>(
      `select m.status as status, o.kind::text as kind
         from messages m
         left join outcomes o on o.attributed_message_id = m.id
        where m.id = $1`,
      [message_id],
    );
    assert.equal(rows[0].status, "bounced");
    assert.equal(rows[0].kind, "do_not_contact");
  } finally {
    await pgBus.close();
    await fx.close();
  }
});
