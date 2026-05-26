import type { Pool } from "pg";
import type { PostgresEventBus } from "../substrate/events/adapters/postgres.ts";
import { getProductEngine } from "./app.ts";

export interface InboundEmailReplyInput {
  workspace_id: string;
  in_reply_to_external_id: string;
  external_id: string;
  from_email: string;
  subject?: string | null;
  body: string;
}

export interface InboundEmailReplyResult {
  inbound_message_id: string;
  conversation_id: string;
  intent: string;
  outcome_id: string | null;
}

interface SentMessageRow {
  id: string;
  workspace_id: string;
  conversation_id: string;
  channel: "email";
  external_thread_id: string | null;
}

interface AttributionRow {
  play_id: string | null;
  play_run_id: string | null;
  rep_id: string | null;
  signal_id: string | null;
  pattern_key: string | null;
  exemplar_ids: unknown;
}

function classifyReply(body: string): { intent: string; confidence: number; score: number } {
  const text = body.toLowerCase();
  if (/(unsubscribe|remove me|do not contact|don't contact)/.test(text)) {
    return { intent: "unsubscribe", confidence: 0.92, score: -0.7 };
  }
  if (/(not interested|no thanks|not a fit|stop)/.test(text)) {
    return { intent: "negative", confidence: 0.82, score: -0.2 };
  }
  if (/(book|meet|meeting|interested|sounds good|yes|let's|lets|calendar|demo)/.test(text)) {
    return { intent: "positive", confidence: 0.86, score: 0.8 };
  }
  return { intent: "neutral", confidence: 0.58, score: 0 };
}

function outcomeKindForIntent(intent: string): "positive_reply" | "unsubscribe" | null {
  if (intent === "positive") return "positive_reply";
  if (intent === "unsubscribe") return "unsubscribe";
  return null;
}

async function findAttribution(
  pool: Pool,
  workspace_id: string,
  message_id: string,
): Promise<AttributionRow> {
  const { rows } = await pool.query<AttributionRow>(
    `select wr.play_id,
            wr.play_run_id,
            (wr.input->>'rep_id')::uuid as rep_id,
            (wr.input->>'signal_id')::uuid as signal_id,
            m.provenance->>'pattern_key' as pattern_key,
            m.provenance->'exemplar_ids' as exemplar_ids
       from messages m
       left join workflow_runs wr
         on wr.workspace_id = m.workspace_id
        and wr.output->>'message_id' = m.id::text
      where m.workspace_id = $1
        and m.id = $2
      order by wr.created_at desc
      limit 1`,
    [workspace_id, message_id],
  );
  return rows[0] ?? {
    play_id: null,
    play_run_id: null,
    rep_id: null,
    signal_id: null,
    pattern_key: null,
    exemplar_ids: [],
  };
}

async function publishReplyEvents(
  bus: PostgresEventBus,
  input: {
    workspace_id: string;
    conversation_id: string;
    message_id: string;
    intent: string;
    confidence: number;
  },
): Promise<void> {
  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "reply.received",
    source: "system",
    producer_ref: "channel:email:inbound",
    payload: {
      conversation_id: input.conversation_id,
      message_id: input.message_id,
      channel: "email",
    },
  });
  await bus.publish({
    workspace_id: input.workspace_id,
    event_type: "reply.classified",
    source: "system",
    producer_ref: "channel:email:inbound",
    payload: {
      conversation_id: input.conversation_id,
      message_id: input.message_id,
      intent: input.intent,
      confidence: input.confidence,
    },
  });
}

export async function recordInboundEmailReply(
  input: InboundEmailReplyInput,
): Promise<InboundEmailReplyResult> {
  const engine = await getProductEngine();
  const sent = await engine.pool.query<SentMessageRow>(
    `select id, workspace_id, conversation_id, channel, external_thread_id
       from messages
      where workspace_id = $1
        and channel = 'email'
        and direction = 'outbound'
        and external_id = $2
      limit 1`,
    [input.workspace_id, input.in_reply_to_external_id],
  );
  const original = sent.rows[0];
  if (!original) {
    throw new Error(`Outbound message not found: ${input.in_reply_to_external_id}`);
  }

  const classification = classifyReply(input.body);
  const inbound = await engine.pool.query<{ id: string }>(
    `insert into messages (
       workspace_id, conversation_id, channel, direction, status,
       subject, body, external_id, external_thread_id,
       intent_class, intent_confidence, delivered_at, properties, provenance
     ) values (
       $1, $2, 'email', 'inbound', 'delivered',
       $3, $4, $5, $6,
       $7, $8, now(), $9::jsonb, $10::jsonb
     )
     returning id`,
    [
      input.workspace_id,
      original.conversation_id,
      input.subject ?? null,
      input.body,
      input.external_id,
      original.external_thread_id,
      classification.intent,
      classification.confidence,
      JSON.stringify({ from_email: input.from_email }),
      JSON.stringify({
        source: "email_inbound",
        in_reply_to_external_id: input.in_reply_to_external_id,
      }),
    ],
  );
  const inbound_message_id = inbound.rows[0]!.id;

  await engine.pool.query(
    `update messages
        set status = 'replied',
            replied_at = now()
      where id = $1`,
    [original.id],
  );

  await publishReplyEvents(engine.bus, {
    workspace_id: input.workspace_id,
    conversation_id: original.conversation_id,
    message_id: inbound_message_id,
    intent: classification.intent,
    confidence: classification.confidence,
  });

  const kind = outcomeKindForIntent(classification.intent);
  let outcome_id: string | null = null;
  if (kind) {
    const attribution = await findAttribution(
      engine.pool,
      input.workspace_id,
      original.id,
    );
    const outcome = await engine.pool.query<{ id: string }>(
      `insert into outcomes (
         workspace_id, kind, score, conversation_id,
         attributed_message_id, attributed_signal_id, attributed_play_id,
         attributed_play_run_id, attributed_rep_id, properties, provenance
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
       returning id`,
      [
        input.workspace_id,
        kind,
        classification.score,
        original.conversation_id,
        original.id,
        attribution.signal_id,
        attribution.play_id,
        attribution.play_run_id,
        attribution.rep_id,
        JSON.stringify({
          pattern_key: attribution.pattern_key,
          exemplar_ids: Array.isArray(attribution.exemplar_ids)
            ? attribution.exemplar_ids
            : [],
          reply_message_id: inbound_message_id,
        }),
        JSON.stringify({ source: "email_inbound" }),
      ],
    );
    outcome_id = outcome.rows[0]!.id;
    await engine.bus.publish({
      workspace_id: input.workspace_id,
      event_type: "outcome.recorded",
      source: "system",
      producer_ref: "channel:email:inbound",
      payload: {
        outcome_id,
        kind,
        score: classification.score,
        conversation_id: original.conversation_id,
        attributed_play_id: attribution.play_id,
        attributed_play_run_id: attribution.play_run_id,
        attributed_message_id: original.id,
        attributed_rep_id: attribution.rep_id,
        properties: {
          pattern_key: attribution.pattern_key,
          exemplar_ids: Array.isArray(attribution.exemplar_ids)
            ? attribution.exemplar_ids
            : [],
          reply_message_id: inbound_message_id,
        },
      },
    });
  }

  return {
    inbound_message_id,
    conversation_id: original.conversation_id,
    intent: classification.intent,
    outcome_id,
  };
}
