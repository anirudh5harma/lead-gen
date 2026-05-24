import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../../substrate/events/index.ts";
import type {
  IntentClassifier,
  ReplyIntent,
} from "./intent.ts";

/**
 * Inbound email pipeline. Channel adapters (Outlook subscription handler,
 * SES inbound webhook) convert their provider-specific payloads into a
 * canonical `InboundEmail` and call `handleInboundEmail`. The pipeline:
 *
 *   1. Match the inbound to an existing conversation (by external_thread_id,
 *      In-Reply-To, References, or a recent-recipient fallback).
 *   2. Insert an inbound `messages` row in 'delivered' state.
 *   3. Emit `reply.received` on the bus.
 *   4. Classify intent (LLM via IntentClassifier).
 *   5. Update the inbound row with intent class + confidence.
 *   6. Emit `reply.classified`.
 *   7. For win/loss intents: insert an `outcomes` row + emit
 *      `outcome.recorded`. The procedural-memory bridge (already wired)
 *      sees that event and updates the contributing exemplars.
 *
 * If no conversation matches, the inbound row is still inserted but with
 * conversation_id NULL is not supported by the schema — instead, we emit
 * `reply.received` with conversation_id = null and SKIP the inbound row
 * insert; the surface layer can surface "unmatched replies" to the user.
 */

export interface InboundEmail {
  workspace_id: string;
  /** Provider's id for this inbound message. Used for dedup. */
  external_id: string;
  /** Provider's thread / conversation id, when available. */
  external_thread_id?: string;
  /** RFC 5322 In-Reply-To header. */
  in_reply_to?: string;
  /** RFC 5322 References header (parsed into list of Message-IDs). */
  references?: string[];

  from: { email: string; name?: string };
  subject: string;
  body_text: string;
  body_html?: string;
  received_at: string;

  /** Which channel account received this inbound. */
  channel_account_id?: string;
}

export interface HandleInboundDeps {
  pool: Pool;
  bus: EventBus;
  classifier: IntentClassifier;
}

export interface HandleInboundResult {
  matched_conversation_id: string | null;
  /** Null when no conversation matched (no row inserted). */
  inbound_message_id: string | null;
  intent?: ReplyIntent;
  intent_confidence?: number;
  outcome_id?: string;
}

interface MatchedOutbound {
  conversation_id: string;
  outbound_message_id: string;
}

const POSITIVE_OUTCOMES: Partial<Record<ReplyIntent, { kind: string; score: number }>> = {
  positive: { kind: "positive_reply", score: 1 },
  unsubscribe: { kind: "unsubscribe", score: -1 },
  do_not_contact: { kind: "do_not_contact", score: -1 },
};

export async function handleInboundEmail(
  deps: HandleInboundDeps,
  inbound: InboundEmail,
): Promise<HandleInboundResult> {
  const { pool, bus, classifier } = deps;

  // Dedup: if we've already processed this provider id, skip.
  const existing = await pool.query<{ id: string; conversation_id: string }>(
    `select id, conversation_id from messages
      where workspace_id = $1 and channel = 'email'
        and direction = 'inbound' and external_id = $2
      limit 1`,
    [inbound.workspace_id, inbound.external_id],
  );
  if (existing.rows[0]) {
    return {
      matched_conversation_id: existing.rows[0].conversation_id,
      inbound_message_id: existing.rows[0].id,
    };
  }

  const matched = await matchConversation(pool, inbound);
  if (!matched) {
    await bus.publish({
      workspace_id: inbound.workspace_id,
      event_type: "reply.received",
      source: "webhook",
      producer_ref: "channel:email:inbound",
      payload: {
        conversation_id: "00000000-0000-0000-0000-000000000000",
        message_id: "00000000-0000-0000-0000-000000000000",
        channel: "email",
      },
    });
    return { matched_conversation_id: null, inbound_message_id: null };
  }

  // Insert inbound row + bump conversation last_activity_at and awaiting flip.
  const inbound_message_id = randomUUID();
  await pool.query(
    `insert into messages (
       id, workspace_id, conversation_id,
       channel, direction, status,
       subject, body, body_html,
       external_id, external_thread_id,
       channel_account_id,
       sent_at, delivered_at, replied_at,
       provenance, created_at
     ) values (
       $1, $2, $3,
       'email', 'inbound', 'delivered',
       $4, $5, $6,
       $7, $8,
       $9,
       $10::timestamptz, $10::timestamptz, $10::timestamptz,
       $11::jsonb, now()
     )`,
    [
      inbound_message_id,
      inbound.workspace_id,
      matched.conversation_id,
      inbound.subject,
      inbound.body_text,
      inbound.body_html ?? null,
      inbound.external_id,
      inbound.external_thread_id ?? null,
      inbound.channel_account_id ?? null,
      inbound.received_at,
      JSON.stringify({
        from_email: inbound.from.email,
        from_name: inbound.from.name ?? null,
        in_reply_to: inbound.in_reply_to ?? null,
        references: inbound.references ?? [],
        matched_outbound_message_id: matched.outbound_message_id,
      }),
    ],
  );
  await pool.query(
    `update conversations
        set last_activity_at = $2::timestamptz,
            status = 'awaiting_us'
      where id = $1`,
    [matched.conversation_id, inbound.received_at],
  );
  // Mark the outbound it replies to.
  await pool.query(
    `update messages set status = 'replied', replied_at = $2::timestamptz
      where id = $1`,
    [matched.outbound_message_id, inbound.received_at],
  );

  await bus.publish({
    workspace_id: inbound.workspace_id,
    event_type: "reply.received",
    source: "webhook",
    producer_ref: "channel:email:inbound",
    correlation_id: matched.conversation_id,
    payload: {
      conversation_id: matched.conversation_id,
      message_id: inbound_message_id,
      channel: "email",
    },
  });

  // Classification + intent persistence.
  const priorOutbound = await pool.query<{ subject: string; body: string }>(
    `select subject, body from messages where id = $1`,
    [matched.outbound_message_id],
  );
  const repName = await loadRepName(pool, matched.conversation_id);
  const classification = await classifier.classify({
    subject: inbound.subject,
    body_text: inbound.body_text,
    context: {
      rep_name: repName ?? "the Rep",
      prior_outbound_subject: priorOutbound.rows[0]?.subject,
      prior_outbound_excerpt: priorOutbound.rows[0]?.body?.slice(0, 800),
    },
  });

  await pool.query(
    `update messages
        set intent_class = $2,
            intent_confidence = $3,
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $4::jsonb
      where id = $1`,
    [
      inbound_message_id,
      classification.intent,
      classification.confidence,
      JSON.stringify({ intent_reason: classification.reason }),
    ],
  );

  await bus.publish({
    workspace_id: inbound.workspace_id,
    event_type: "reply.classified",
    source: "system",
    producer_ref: "channel:email:intent",
    correlation_id: matched.conversation_id,
    payload: {
      conversation_id: matched.conversation_id,
      message_id: inbound_message_id,
      intent: classification.intent,
      confidence: classification.confidence,
    },
  });

  // Conversation status reflects the intent (positive → awaiting_us;
  // negative / unsubscribe → closed_negative; ooo / spam → no change beyond
  // awaiting_us).
  if (
    classification.intent === "negative" ||
    classification.intent === "unsubscribe" ||
    classification.intent === "do_not_contact"
  ) {
    await pool.query(
      `update conversations
          set status = 'closed_negative', closed_at = $2::timestamptz
        where id = $1`,
      [matched.conversation_id, inbound.received_at],
    );
  } else if (classification.intent === "positive") {
    // Already awaiting_us; leave as is.
  }

  const outcome = POSITIVE_OUTCOMES[classification.intent];
  let outcome_id: string | undefined;
  if (outcome) {
    outcome_id = randomUUID();
    // Find attributed_rep_id + play_id from the conversation for richer attribution.
    const attribRes = await pool.query<{
      rep_id: string;
      origin_signal_id: string | null;
    }>(
      `select rep_id, origin_signal_id from conversations where id = $1`,
      [matched.conversation_id],
    );
    const attrib = attribRes.rows[0];
    await pool.query(
      `insert into outcomes (
         id, workspace_id, kind, score,
         conversation_id, attributed_message_id, attributed_signal_id,
         attributed_rep_id, occurred_at, recorded_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, now())`,
      [
        outcome_id,
        inbound.workspace_id,
        outcome.kind,
        outcome.score,
        matched.conversation_id,
        matched.outbound_message_id,
        attrib?.origin_signal_id ?? null,
        attrib?.rep_id ?? null,
        inbound.received_at,
      ],
    );
    await bus.publish({
      workspace_id: inbound.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      producer_ref: "channel:email:reply",
      correlation_id: matched.conversation_id,
      payload: {
        outcome_id,
        kind: outcome.kind,
        score: outcome.score,
        conversation_id: matched.conversation_id,
        attributed_play_id: null,
      },
    });
  }

  return {
    matched_conversation_id: matched.conversation_id,
    inbound_message_id,
    intent: classification.intent,
    intent_confidence: classification.confidence,
    outcome_id,
  };
}

async function matchConversation(
  pool: Pool,
  inbound: InboundEmail,
): Promise<MatchedOutbound | null> {
  // Strategy 1: provider thread id.
  if (inbound.external_thread_id) {
    const res = await pool.query<MatchedOutbound>(
      `select conversation_id, id as outbound_message_id from messages
        where workspace_id = $1 and channel = 'email'
          and direction = 'outbound'
          and external_thread_id = $2
        order by sent_at desc nulls last
        limit 1`,
      [inbound.workspace_id, inbound.external_thread_id],
    );
    if (res.rows[0]) return res.rows[0];
  }

  // Strategy 2: In-Reply-To matches an outbound external_id.
  if (inbound.in_reply_to) {
    const res = await pool.query<MatchedOutbound>(
      `select conversation_id, id as outbound_message_id from messages
        where workspace_id = $1 and channel = 'email'
          and direction = 'outbound'
          and external_id = $2
        limit 1`,
      [inbound.workspace_id, inbound.in_reply_to],
    );
    if (res.rows[0]) return res.rows[0];
  }

  // Strategy 3: References list contains one of our outbound external_ids.
  if (inbound.references && inbound.references.length > 0) {
    const res = await pool.query<MatchedOutbound>(
      `select conversation_id, id as outbound_message_id from messages
        where workspace_id = $1 and channel = 'email'
          and direction = 'outbound'
          and external_id = any($2::text[])
        order by sent_at desc nulls last
        limit 1`,
      [inbound.workspace_id, inbound.references],
    );
    if (res.rows[0]) return res.rows[0];
  }

  // Strategy 4: most recent outbound to this address within 30 days.
  const res = await pool.query<MatchedOutbound>(
    `select m.conversation_id, m.id as outbound_message_id from messages m
       join conversations c on c.id = m.conversation_id
       join graph_persons p on p.id = c.counterparty_person_id
      where m.workspace_id = $1
        and m.channel = 'email'
        and m.direction = 'outbound'
        and m.status in ('sent', 'delivered', 'replied')
        and m.sent_at >= now() - interval '30 days'
        and p.emails @> array[$2]::citext[]
      order by m.sent_at desc
      limit 1`,
    [inbound.workspace_id, inbound.from.email],
  );
  return res.rows[0] ?? null;
}

async function loadRepName(pool: Pool, conversation_id: string): Promise<string | null> {
  const { rows } = await pool.query<{ name: string }>(
    `select r.name from conversations c
       join reps r on r.id = c.rep_id
      where c.id = $1`,
    [conversation_id],
  );
  return rows[0]?.name ?? null;
}
