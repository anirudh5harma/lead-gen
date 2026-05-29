import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { EventBus } from "../../substrate/events/index.ts";
import type {
  IntentClassification,
  IntentClassifier,
  ReplyIntent,
} from "./intent.ts";
import { projectReplyLifecycleEvent } from "../reply-lifecycle.ts";

/**
 * Inbound email projector. Provider ingress is authenticated at the surface
 * and emitted as `email.inbound.received` or
 * `email.outlook.notification.received`; the projector consumer calls this
 * pipeline after receiving those durable events:
 *
 *   1. Match the inbound to an existing conversation (by external_thread_id,
 *      In-Reply-To, References, or a recent-recipient fallback).
 *   2. Publish `reply.received`; shared lifecycle projection materializes the
 *      inbound `messages` row, outbound replied state, and conversation status.
 *   3. Classify intent (LLM via IntentClassifier).
 *   4. Publish `reply.classified`; shared lifecycle projection materializes
 *      intent class, confidence, and terminal conversation status.
 *   5. For win/loss intents: insert an `outcomes` row + emit
 *      `outcome.recorded`. The procedural-memory bridge (already wired)
 *      sees that event and updates the contributing exemplars.
 *
 * If no conversation matches, we emit `reply.unmatched` and skip lifecycle
 * materialization; the surface layer can surface the unmatched provider event for
 * operator recovery without minting fake Conversation/Message ids.
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
  /** Present when invoked from a durable provider-ingress projector. */
  ingress_event_id?: string;
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

interface ExistingInbound {
  id: string;
  conversation_id: string;
  intent_class: ReplyIntent | null;
  intent_confidence: string | null;
  provenance: { matched_outbound_message_id?: string } | null;
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

  // Non-projector callers preserve historical provider-id dedup semantics.
  // Durable projector redelivery, however, must resume any interrupted stage.
  const existing = await pool.query<ExistingInbound>(
    `select id, conversation_id, intent_class,
            intent_confidence::text as intent_confidence, provenance
       from messages
      where workspace_id = $1 and channel = 'email'
        and direction = 'inbound' and external_id = $2
      limit 1`,
    [inbound.workspace_id, inbound.external_id],
  );
  const existingMessage = existing.rows[0];
  if (existingMessage && !deps.ingress_event_id) {
    return {
      matched_conversation_id: existingMessage.conversation_id,
      inbound_message_id: existingMessage.id,
    };
  }

  const matched: MatchedOutbound | null = existingMessage
    ? {
        conversation_id: existingMessage.conversation_id,
        outbound_message_id:
          existingMessage.provenance?.matched_outbound_message_id ??
          (await matchConversation(pool, inbound))?.outbound_message_id ??
          "",
      }
    : await matchConversation(pool, inbound);
  if (matched && !matched.outbound_message_id) {
    return {
      matched_conversation_id: matched.conversation_id,
      inbound_message_id: existingMessage?.id ?? null,
    };
  }
  if (!matched) {
    await bus.publish({
      workspace_id: inbound.workspace_id,
      event_type: "reply.unmatched",
      source: "webhook",
      producer_ref: "channel:email:inbound",
      idempotency_key: projectionEventKey(deps.ingress_event_id, "reply.unmatched"),
      payload: {
        channel: "email",
        external_id: inbound.external_id,
        from_email: inbound.from.email,
        subject: inbound.subject,
        received_at: inbound.received_at,
      },
    });
    return { matched_conversation_id: null, inbound_message_id: null };
  }

  const inbound_message_id = existingMessage?.id ?? randomUUID();
  const replyReceived = await bus.publish({
    workspace_id: inbound.workspace_id,
    event_type: "reply.received",
    source: "webhook",
    producer_ref: "channel:email:inbound",
    correlation_id: matched.conversation_id,
    idempotency_key: projectionEventKey(deps.ingress_event_id, "reply.received"),
    payload: {
      conversation_id: matched.conversation_id,
      message_id: inbound_message_id,
      channel: "email",
      matched_outbound_message_id: matched.outbound_message_id,
      external_id: inbound.external_id,
      external_thread_id: inbound.external_thread_id ?? null,
      in_reply_to: inbound.in_reply_to ?? null,
      references: inbound.references ?? [],
      from: {
        email: inbound.from.email,
        name: inbound.from.name ?? null,
      },
      subject: inbound.subject,
      body_text: inbound.body_text,
      body_html: inbound.body_html ?? null,
      received_at: inbound.received_at,
      channel_account_id: inbound.channel_account_id ?? null,
    },
  });
  await projectReplyLifecycleEvent(pool, replyReceived);

  // Classification + intent persistence. On a redelivery after this update,
  // reuse the persisted verdict rather than issuing another LLM call.
  let classification: IntentClassification;
  if (existingMessage?.intent_class && existingMessage.intent_confidence !== null) {
    classification = {
      intent: existingMessage.intent_class,
      confidence: Number(existingMessage.intent_confidence),
      reason: "persisted projector result",
    };
  } else {
    const priorOutbound = await pool.query<{ subject: string; body: string }>(
      `select subject, body from messages where id = $1`,
      [matched.outbound_message_id],
    );
    const repName = await loadRepName(pool, matched.conversation_id);
    classification = await classifier.classify({
      subject: inbound.subject,
      body_text: inbound.body_text,
      context: {
        rep_name: repName ?? "the Rep",
        prior_outbound_subject: priorOutbound.rows[0]?.subject,
        prior_outbound_excerpt: priorOutbound.rows[0]?.body?.slice(0, 800),
      },
    });

  }

  const replyClassified = await bus.publish({
    workspace_id: inbound.workspace_id,
    event_type: "reply.classified",
    source: "system",
    producer_ref: "channel:email:intent",
    correlation_id: matched.conversation_id,
    idempotency_key: projectionEventKey(deps.ingress_event_id, "reply.classified"),
    payload: {
      conversation_id: matched.conversation_id,
      message_id: inbound_message_id,
      intent: classification.intent,
      confidence: classification.confidence,
      reason: classification.reason,
      received_at: inbound.received_at,
    },
  });
  await projectReplyLifecycleEvent(pool, replyClassified);

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
    const insertedOutcome = await pool.query<{ id: string }>(
      `insert into outcomes (
         id, workspace_id, kind, score,
         conversation_id, attributed_message_id, attributed_signal_id,
         attributed_rep_id, provenance, occurred_at, recorded_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::timestamptz, now())
       on conflict (workspace_id, (provenance ->> 'ingress_event_id'), kind)
         where provenance ? 'ingress_event_id'
       do nothing
       returning id`,
      [
        outcome_id,
        inbound.workspace_id,
        outcome.kind,
        outcome.score,
        matched.conversation_id,
        matched.outbound_message_id,
        attrib?.origin_signal_id ?? null,
        attrib?.rep_id ?? null,
        JSON.stringify(
          deps.ingress_event_id ? { ingress_event_id: deps.ingress_event_id } : {},
        ),
        inbound.received_at,
      ],
    );
    if (insertedOutcome.rows[0]) {
      outcome_id = insertedOutcome.rows[0].id;
    } else if (deps.ingress_event_id) {
      const existingOutcome = await pool.query<{ id: string }>(
        `select id from outcomes
          where workspace_id = $1
            and provenance ->> 'ingress_event_id' = $2
            and kind = $3
          limit 1`,
        [inbound.workspace_id, deps.ingress_event_id, outcome.kind],
      );
      outcome_id = existingOutcome.rows[0]?.id;
    }
    if (outcome_id) {
      await bus.publish({
        workspace_id: inbound.workspace_id,
        event_type: "outcome.recorded",
        source: "system",
        producer_ref: "channel:email:reply",
        correlation_id: matched.conversation_id,
        idempotency_key: projectionEventKey(deps.ingress_event_id, "outcome.recorded"),
        payload: {
          outcome_id,
          kind: outcome.kind,
          score: outcome.score,
          conversation_id: matched.conversation_id,
          attributed_play_id: null,
        },
      });
    }
  }

  return {
    matched_conversation_id: matched.conversation_id,
    inbound_message_id,
    intent: classification.intent,
    intent_confidence: classification.confidence,
    outcome_id,
  };
}

function projectionEventKey(ingressEventId: string | undefined, projected: string) {
  return ingressEventId ? `projection:${ingressEventId}:${projected}` : null;
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
