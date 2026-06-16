import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { setupPg, until } from "./_pg.ts";
import { createPostgresEventBus } from "../core/substrate/events/adapters/postgres.ts";
import { createInMemoryEventBus } from "../core/substrate/events/adapters/in-memory.ts";
import {
  createFixedIntentClassifier,
  handleInboundEmail,
  type InboundEmail,
} from "../core/channels/email/index.ts";

interface Seeded {
  workspace_id: string;
  rep_id: string;
  conversation_id: string;
  outbound_message_id: string;
  outbound_external_id: string;
  counterparty_email: string;
}

async function seedConversationWithOutbound(
  pool: Pool,
  overrides: Partial<{ external_thread_id: string }> = {},
): Promise<Seeded> {
  const workspace_id = randomUUID();
  await pool.query(
    `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
    [workspace_id, `ws-${workspace_id.slice(0, 8)}`, "ws"],
  );
  const rep_id = randomUUID();
  await pool.query(
    `insert into reps (id, workspace_id, name, role, status, persona)
     values ($1, $2, 'Maya', 'sdr', 'active', '{"voice":"warm"}'::jsonb)`,
    [rep_id, workspace_id],
  );
  const counterparty_person_id = randomUUID();
  const counterparty_email = "anne@example.com";
  await pool.query(
    `insert into graph_persons (id, workspace_id, full_name, emails)
     values ($1, $2, 'Anne', array[$3]::citext[])`,
    [counterparty_person_id, workspace_id, counterparty_email],
  );
  const conversation_id = randomUUID();
  await pool.query(
    `insert into conversations (
       id, workspace_id, rep_id, counterparty_person_id,
       topic, status, started_at, last_activity_at
     ) values ($1, $2, $3, $4, 'saw your series a', 'awaiting_them', now(), now())`,
    [conversation_id, workspace_id, rep_id, counterparty_person_id],
  );

  const outbound_message_id = randomUUID();
  const outbound_external_id = `ses-${randomUUID()}`;
  await pool.query(
    `insert into messages (
       id, workspace_id, conversation_id, channel, direction, status,
       subject, body, external_id, external_thread_id,
       sent_at, provenance
     ) values (
       $1, $2, $3, 'email', 'outbound', 'sent',
       'saw your series a', 'Anne, congrats on the round.', $4, $5,
       now() - interval '5 minutes',
       $6::jsonb
     )`,
    [
      outbound_message_id,
      workspace_id,
      conversation_id,
      outbound_external_id,
      overrides.external_thread_id ?? null,
      JSON.stringify({
        exemplar_ids: ["ex-1"],
        pattern_key: "icp:fintech-founder|signal:funding|channel:email|stage:cold_open",
      }),
    ],
  );

  return {
    workspace_id,
    rep_id,
    conversation_id,
    outbound_message_id,
    outbound_external_id,
    counterparty_email,
  };
}

test("reply: unmatched inbound publishes a typed reply.unmatched event without sentinel ids", async () => {
  const workspace_id = randomUUID();
  const bus = createInMemoryEventBus();
  const pool = {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Pool;
  const received_at = new Date().toISOString();

  const result = await handleInboundEmail(
    {
      pool,
      bus,
      classifier: createFixedIntentClassifier("positive", 1),
      ingress_event_id: randomUUID(),
    },
    {
      workspace_id,
      external_id: "inbound-no-match",
      from: { email: "stranger@example.com" },
      subject: "hi",
      body_text: "who is this?",
      received_at,
    },
  );

  assert.equal(result.matched_conversation_id, null);
  assert.equal(result.inbound_message_id, null);
  assert.equal(bus.published.length, 1);
  const event = bus.published[0]!;
  const payload = event.payload as {
    channel: string;
    external_id: string;
    from_email: string;
    subject: string;
    received_at: string;
  };
  assert.equal(event.event_type, "reply.unmatched");
  assert.deepEqual(payload, {
    channel: "email",
    external_id: "inbound-no-match",
    from_email: "stranger@example.com",
    subject: "hi",
    received_at,
  });
  assert.ok(!("conversation_id" in payload));
  assert.ok(!("message_id" in payload));
});

// ─── Matching strategies ────────────────────────────────────────────────────

test("reply: matches by In-Reply-To header → records inbound, classifies, emits events", async (t) => {
  const fx = await setupPg("rep_irt");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);

    const seenReceived: string[] = [];
    const seenClassified: string[] = [];
    const seenRoleActivity: string[] = [];
    await bus.subscribe("reply.received", (e) => {
      seenReceived.push((e.payload as { message_id: string }).message_id);
    });
    await bus.subscribe("reply.classified", (e) => {
      seenClassified.push((e.payload as { intent: string }).intent);
    });
    await bus.subscribe("rep.role.completed", (e) => {
      seenRoleActivity.push((e.payload as { role: string; action: string }).action);
    });

    const inbound: InboundEmail = {
      workspace_id: seeded.workspace_id,
      external_id: `in-${randomUUID()}`,
      in_reply_to: seeded.outbound_external_id,
      from: { email: seeded.counterparty_email, name: "Anne" },
      subject: "Re: saw your series a",
      body_text: "Thanks for reaching out — happy to chat. Tuesday 3pm?",
      received_at: new Date().toISOString(),
    };

    const result = await handleInboundEmail(
      { pool: fx.pool, bus, classifier: createFixedIntentClassifier("positive", 0.9) },
      inbound,
    );
    assert.equal(result.matched_conversation_id, seeded.conversation_id);
    assert.equal(result.intent, "positive");

    await until(
      () =>
        seenReceived.length === 1 &&
        seenClassified.length === 1 &&
        seenRoleActivity.length === 1,
    );
    assert.deepEqual(seenClassified, ["positive"]);
    assert.deepEqual(seenRoleActivity, ["classify_inbound_reply"]);

    // Inbound row exists with intent populated.
    const { rows: msgRows } = await fx.pool.query<{
      direction: string;
      status: string;
      intent_class: string;
      intent_confidence: string;
      conversation_id: string;
    }>(
      `select direction::text as direction, status::text as status,
              intent_class, intent_confidence::text as intent_confidence,
              conversation_id
         from messages where id = $1`,
      [result.inbound_message_id],
    );
    assert.equal(msgRows[0].direction, "inbound");
    assert.equal(msgRows[0].status, "delivered");
    assert.equal(msgRows[0].intent_class, "positive");
    assert.equal(Number(msgRows[0].intent_confidence), 0.9);
    assert.equal(msgRows[0].conversation_id, seeded.conversation_id);

    // The outbound it replies to was flipped to 'replied'.
    const { rows: outboundRows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from messages where id = $1`,
      [seeded.outbound_message_id],
    );
    assert.equal(outboundRows[0].status, "replied");

    // Conversation moved to awaiting_us.
    const { rows: convRows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from conversations where id = $1`,
      [seeded.conversation_id],
    );
    assert.equal(convRows[0].status, "awaiting_us");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("reply: matches by external_thread_id (Outlook conversationId)", async (t) => {
  const fx = await setupPg("rep_thr");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const threadId = `thr-${randomUUID()}`;
    const seeded = await seedConversationWithOutbound(fx.pool, {
      external_thread_id: threadId,
    });

    const inbound: InboundEmail = {
      workspace_id: seeded.workspace_id,
      external_id: `in-${randomUUID()}`,
      external_thread_id: threadId,
      from: { email: seeded.counterparty_email },
      subject: "Re: x",
      body_text: "ok",
      received_at: new Date().toISOString(),
    };
    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("neutral", 0.8),
      },
      inbound,
    );
    assert.equal(result.matched_conversation_id, seeded.conversation_id);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("reply: falls back to recent-recipient match when no headers helpful", async (t) => {
  const fx = await setupPg("rep_fall");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);
    const inbound: InboundEmail = {
      workspace_id: seeded.workspace_id,
      external_id: `in-${randomUUID()}`,
      from: { email: seeded.counterparty_email },
      subject: "About earlier",
      body_text: "let me think about it",
      received_at: new Date().toISOString(),
    };
    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("neutral", 0.7),
      },
      inbound,
    );
    assert.equal(result.matched_conversation_id, seeded.conversation_id);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("reply: unmatched inbound emits reply.unmatched and skips DB writes", async (t) => {
  const fx = await setupPg("rep_un");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const workspace_id = randomUUID();
    await fx.pool.query(
      `insert into workspaces (id, slug, name) values ($1, $2, $3)`,
      [workspace_id, "ws", "ws"],
    );
    const inbound: InboundEmail = {
      workspace_id,
      external_id: `in-${randomUUID()}`,
      in_reply_to: "nope",
      from: { email: "stranger@example.com" },
      subject: "hi",
      body_text: "who is this?",
      received_at: new Date().toISOString(),
    };
    const unmatchedEvents: Array<{
      external_id: string;
      from_email: string;
      subject: string;
    }> = [];
    await bus.subscribe("reply.unmatched", (e) => {
      unmatchedEvents.push(
        e.payload as {
          external_id: string;
          from_email: string;
          subject: string;
        },
      );
    });
    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("positive", 1),
      },
      inbound,
    );
    assert.equal(result.matched_conversation_id, null);
    assert.equal(result.inbound_message_id, null);
    assert.equal(result.intent, undefined);
    await until(() => unmatchedEvents.length === 1);
    assert.equal(unmatchedEvents[0].external_id, inbound.external_id);
    assert.equal(unmatchedEvents[0].from_email, "stranger@example.com");
    assert.equal(unmatchedEvents[0].subject, "hi");

    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from messages where workspace_id = $1`,
      [workspace_id],
    );
    assert.equal(Number(rows[0].n), 0);
  } finally {
    await bus.close();
    await fx.close();
  }
});

// ─── Dedup ──────────────────────────────────────────────────────────────────

test("reply: dedupes by (workspace, channel, direction, external_id)", async (t) => {
  const fx = await setupPg("rep_dup");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);
    const inbound: InboundEmail = {
      workspace_id: seeded.workspace_id,
      external_id: "in-stable-id",
      in_reply_to: seeded.outbound_external_id,
      from: { email: seeded.counterparty_email },
      subject: "Re: x",
      body_text: "ok",
      received_at: new Date().toISOString(),
    };
    const deps = {
      pool: fx.pool,
      bus,
      classifier: createFixedIntentClassifier("neutral", 0.5),
    };
    const first = await handleInboundEmail(deps, inbound);
    const second = await handleInboundEmail(deps, inbound);
    assert.equal(first.inbound_message_id, second.inbound_message_id);
    const { rows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from messages
        where workspace_id = $1 and direction = 'inbound'`,
      [seeded.workspace_id],
    );
    assert.equal(Number(rows[0].n), 1);
  } finally {
    await bus.close();
    await fx.close();
  }
});

// ─── Intent → outcome mapping ───────────────────────────────────────────────

test("reply: positive intent records a positive_reply outcome and emits outcome.recorded", async (t) => {
  const fx = await setupPg("rep_outcome_pos");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);
    const seenOutcomes: Array<{ kind: string; conv: string }> = [];
    await bus.subscribe("outcome.recorded", (e) => {
      const p = e.payload as { kind: string; conversation_id: string };
      seenOutcomes.push({ kind: p.kind, conv: p.conversation_id });
    });

    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("positive", 0.95),
      },
      {
        workspace_id: seeded.workspace_id,
        external_id: `in-${randomUUID()}`,
        in_reply_to: seeded.outbound_external_id,
        from: { email: seeded.counterparty_email },
        subject: "Re: saw your series a",
        body_text: "Let's chat — 3pm Tuesday?",
        received_at: new Date().toISOString(),
      },
    );

    assert.ok(result.outcome_id);
    await until(() => seenOutcomes.length === 1);
    assert.equal(seenOutcomes[0].kind, "positive_reply");
    assert.equal(seenOutcomes[0].conv, seeded.conversation_id);

    const { rows } = await fx.pool.query<{
      kind: string;
      score: string;
      attributed_message_id: string;
      attributed_rep_id: string;
    }>(
      `select kind::text as kind, score::text as score,
              attributed_message_id, attributed_rep_id
         from outcomes where id = $1`,
      [result.outcome_id],
    );
    assert.equal(rows[0].kind, "positive_reply");
    assert.equal(Number(rows[0].score), 1);
    assert.equal(rows[0].attributed_message_id, seeded.outbound_message_id);
    assert.equal(rows[0].attributed_rep_id, seeded.rep_id);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("reply: meeting intent records positive_reply outcome while preserving intent class", async (t) => {
  const fx = await setupPg("rep_outcome_meeting");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);

    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier(
          "meeting_intent",
          0.97,
          "Asked to book time.",
        ),
      },
      {
        workspace_id: seeded.workspace_id,
        external_id: `in-${randomUUID()}`,
        in_reply_to: seeded.outbound_external_id,
        from: { email: seeded.counterparty_email },
        subject: "Re: saw your series a",
        body_text: "Can you send a few times for next week?",
        received_at: new Date().toISOString(),
      },
    );

    assert.equal(result.intent, "meeting_intent");
    assert.ok(result.outcome_id);

    const { rows: messageRows } = await fx.pool.query<{
      intent_class: string;
      intent_confidence: string;
    }>(
      `select intent_class, intent_confidence::text as intent_confidence
         from messages where id = $1`,
      [result.inbound_message_id],
    );
    assert.equal(messageRows[0].intent_class, "meeting_intent");
    assert.equal(Number(messageRows[0].intent_confidence), 0.97);

    const { rows: outcomeRows } = await fx.pool.query<{
      kind: string;
      reply_intent: string;
    }>(
      `select kind::text as kind,
              properties->>'reply_intent' as reply_intent
         from outcomes where id = $1`,
      [result.outcome_id],
    );
    assert.equal(outcomeRows[0].kind, "positive_reply");
    assert.equal(outcomeRows[0].reply_intent, "meeting_intent");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("reply: unsubscribe records unsubscribe outcome + closes conversation negatively", async (t) => {
  const fx = await setupPg("rep_outcome_unsub");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);
    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("unsubscribe", 0.99),
      },
      {
        workspace_id: seeded.workspace_id,
        external_id: `in-${randomUUID()}`,
        in_reply_to: seeded.outbound_external_id,
        from: { email: seeded.counterparty_email },
        subject: "stop",
        body_text: "Please remove me from your list.",
        received_at: new Date().toISOString(),
      },
    );
    assert.equal(result.intent, "unsubscribe");
    assert.ok(result.outcome_id);

    const { rows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from conversations where id = $1`,
      [seeded.conversation_id],
    );
    assert.equal(rows[0].status, "closed_negative");

    const { rows: outRows } = await fx.pool.query<{ kind: string }>(
      `select kind::text as kind from outcomes where id = $1`,
      [result.outcome_id],
    );
    assert.equal(outRows[0].kind, "unsubscribe");
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("reply: negative intent records NO outcome but closes conversation", async (t) => {
  const fx = await setupPg("rep_outcome_neg");
  if (!fx) return t.skip("DATABASE_URL not set");
  const bus = await createPostgresEventBus({
    pool: fx.pool,
    listenConnectionString: process.env.DATABASE_URL,
  });
  try {
    const seeded = await seedConversationWithOutbound(fx.pool);
    const result = await handleInboundEmail(
      {
        pool: fx.pool,
        bus,
        classifier: createFixedIntentClassifier("negative", 0.9),
      },
      {
        workspace_id: seeded.workspace_id,
        external_id: `in-${randomUUID()}`,
        in_reply_to: seeded.outbound_external_id,
        from: { email: seeded.counterparty_email },
        subject: "Re: x",
        body_text: "Not interested, thanks.",
        received_at: new Date().toISOString(),
      },
    );
    assert.equal(result.intent, "negative");
    assert.equal(result.outcome_id, undefined);

    const { rows } = await fx.pool.query<{ status: string }>(
      `select status::text as status from conversations where id = $1`,
      [seeded.conversation_id],
    );
    assert.equal(rows[0].status, "closed_negative");

    const { rows: outRows } = await fx.pool.query<{ n: string }>(
      `select count(*)::text as n from outcomes where conversation_id = $1`,
      [seeded.conversation_id],
    );
    assert.equal(Number(outRows[0].n), 0);
  } finally {
    await bus.close();
    await fx.close();
  }
});

test("intent classifier: fixed stub is the contract for tests", async () => {
  const classifier = createFixedIntentClassifier("ooo", 0.5, "auto-reply");
  const v = await classifier.classify({ subject: "x", body_text: "y" });
  assert.equal(v.intent, "ooo");
  assert.equal(v.confidence, 0.5);
  assert.equal(v.reason, "auto-reply");
});
