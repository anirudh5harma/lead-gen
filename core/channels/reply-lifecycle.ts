import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const REPLY_LIFECYCLE_PROJECTION = "channel.reply_lifecycle.v1";

type ReplyLifecycleEvent =
  | PublishedEvent<EventPayload<"reply.received">>
  | PublishedEvent<EventPayload<"reply.classified">>;

export function createReplyLifecycleProjection(pool: Pool): DurableEventProjection {
  return {
    name: REPLY_LIFECYCLE_PROJECTION,
    eventTypes: ["reply.received", "reply.classified"],
    apply: (event) => projectReplyLifecycleEvent(pool, event),
  };
}

export async function projectReplyLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type === "reply.received") {
    await projectReplyReceived(
      pool,
      event as PublishedEvent<EventPayload<"reply.received">>,
    );
  } else if (event.event_type === "reply.classified") {
    await projectReplyClassified(
      pool,
      event as PublishedEvent<EventPayload<"reply.classified">>,
    );
  }
}

async function projectReplyReceived(
  pool: Pool,
  event: ReplyLifecycleEvent & PublishedEvent<EventPayload<"reply.received">>,
): Promise<void> {
  const payload = event.payload;
  const receivedAt = payload.received_at ?? event.occurred_at;

  if (hasInboundMessagePayload(payload)) {
    await pool.query(
      `insert into messages (
         id, workspace_id, conversation_id,
         channel, direction, status,
         subject, body, body_html,
         external_id, external_thread_id,
         channel_account_id,
         sent_at, delivered_at, replied_at,
         provenance, properties, created_at
       ) values (
         $1, $2, $3,
         $4::message_channel, 'inbound', 'delivered',
         $5, $6, $7,
         $8, $9,
         $10::uuid,
         $11::timestamptz, $11::timestamptz, $11::timestamptz,
         $12::jsonb, $13::jsonb, now()
       )
       on conflict (id) do update set
         subject = excluded.subject,
         body = excluded.body,
         body_html = excluded.body_html,
         external_id = excluded.external_id,
         external_thread_id = coalesce(excluded.external_thread_id, messages.external_thread_id),
         channel_account_id = coalesce(excluded.channel_account_id, messages.channel_account_id),
         sent_at = coalesce(messages.sent_at, excluded.sent_at),
         delivered_at = coalesce(messages.delivered_at, excluded.delivered_at),
         replied_at = coalesce(messages.replied_at, excluded.replied_at),
         provenance = messages.provenance || excluded.provenance,
         properties = messages.properties || excluded.properties
       where messages.workspace_id = excluded.workspace_id
         and messages.direction = 'inbound'`,
      [
        payload.message_id,
        event.workspace_id,
        payload.conversation_id,
        payload.channel,
        payload.subject,
        payload.body_text,
        payload.body_html ?? null,
        payload.external_id,
        payload.external_thread_id ?? null,
        payload.channel_account_id ?? null,
        receivedAt,
        JSON.stringify({
          from_email: payload.from.email,
          from_name: payload.from.name ?? null,
          in_reply_to: payload.in_reply_to ?? null,
          references: payload.references ?? [],
          matched_outbound_message_id: payload.matched_outbound_message_id ?? null,
        }),
        JSON.stringify({ reply_received_event_id: event.id }),
      ],
    );
  }

  await pool.query(
    `update conversations
        set last_activity_at = greatest(last_activity_at, $3::timestamptz),
            status = case
              when status::text in ('closed_positive', 'closed_negative', 'closed_no_response')
                then status
              else 'awaiting_us'::conversation_status
            end
      where id = $1
        and workspace_id = $2`,
    [payload.conversation_id, event.workspace_id, receivedAt],
  );

  if (payload.matched_outbound_message_id) {
    await pool.query(
      `update messages
          set status = 'replied'::message_status,
              replied_at = coalesce(replied_at, $3::timestamptz),
              properties = properties || $4::jsonb
        where id = $1
          and workspace_id = $2
          and direction = 'outbound'
          and channel::text = $5`,
      [
        payload.matched_outbound_message_id,
        event.workspace_id,
        receivedAt,
        JSON.stringify({
          reply_received_event_id: event.id,
          inbound_message_id: payload.message_id,
        }),
        payload.channel,
      ],
    );
  }
}

async function projectReplyClassified(
  pool: Pool,
  event: ReplyLifecycleEvent & PublishedEvent<EventPayload<"reply.classified">>,
): Promise<void> {
  const payload = event.payload;
  const classifiedAt = payload.received_at ?? event.occurred_at;
  await pool.query(
    `update messages
        set intent_class = $3,
            intent_confidence = $4,
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $5::jsonb,
            properties = properties || $6::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'inbound'
        and channel::text = $7`,
    [
      payload.message_id,
      event.workspace_id,
      payload.intent,
      payload.confidence,
      JSON.stringify({ intent_reason: payload.reason ?? null }),
      JSON.stringify({ reply_classified_event_id: event.id }),
      "email",
    ],
  );

  if (
    payload.intent === "negative" ||
    payload.intent === "unsubscribe" ||
    payload.intent === "do_not_contact"
  ) {
    await pool.query(
      `update conversations
          set status = 'closed_negative'::conversation_status,
              closed_at = coalesce(closed_at, $3::timestamptz)
        where id = $1
          and workspace_id = $2`,
      [payload.conversation_id, event.workspace_id, classifiedAt],
    );
  }
}

function hasInboundMessagePayload(
  payload: EventPayload<"reply.received">,
): payload is EventPayload<"reply.received"> & {
  external_id: string;
  from: { email: string; name?: string | null };
  subject: string;
  body_text: string;
} {
  return (
    typeof payload.external_id === "string" &&
    typeof payload.subject === "string" &&
    typeof payload.body_text === "string" &&
    typeof payload.from?.email === "string"
  );
}
