import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const MESSAGE_LIFECYCLE_PROJECTION = "channel.message_lifecycle.v1";

type MessageLifecycleEvent =
  | PublishedEvent<EventPayload<"message.queued">>
  | PublishedEvent<EventPayload<"message.sent">>
  | PublishedEvent<EventPayload<"message.deferred">>;

export function createMessageLifecycleProjection(pool: Pool): DurableEventProjection {
  return {
    name: MESSAGE_LIFECYCLE_PROJECTION,
    eventTypes: ["message.queued", "message.sent", "message.deferred"],
    apply: (event) => projectMessageLifecycleEvent(pool, event),
  };
}

export async function projectMessageLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type === "message.queued") {
    await projectMessageQueued(
      pool,
      event as PublishedEvent<EventPayload<"message.queued">>,
    );
  } else if (event.event_type === "message.sent") {
    await projectMessageSent(
      pool,
      event as PublishedEvent<EventPayload<"message.sent">>,
    );
  } else if (event.event_type === "message.deferred") {
    await projectMessageDeferred(
      pool,
      event as PublishedEvent<EventPayload<"message.deferred">>,
    );
  }
}

async function projectMessageQueued(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"message.queued">>,
): Promise<void> {
  const payload = event.payload;
  await pool.query(
    `update messages
        set status = case
              when status::text in ('sent', 'delivered', 'bounced', 'replied')
                then status
              else 'queued'::message_status
            end,
            channel_account_id = coalesce($3::uuid, channel_account_id),
            scheduled_at = coalesce(scheduled_at, coalesce($4::timestamptz, now())),
            properties = properties || $5::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'
        and channel::text = $6`,
    [
      payload.message_id,
      event.workspace_id,
      payload.channel_account_id ?? null,
      payload.scheduled_at,
      JSON.stringify({
        queued_event_id: event.id,
        ...(payload.reserved_at ? { send_reserved_at: payload.reserved_at } : {}),
      }),
      payload.channel,
    ],
  );
}

async function projectMessageSent(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"message.sent">>,
): Promise<void> {
  const payload = event.payload;
  await pool.query(
    `update messages
        set status = case
              when status::text in ('delivered', 'bounced', 'replied')
                then status
              else 'sent'::message_status
            end,
            external_id = coalesce($3, external_id),
            channel_account_id = coalesce($7::uuid, channel_account_id),
            sent_at = coalesce(sent_at, $4::timestamptz),
            properties = properties || $5::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'
        and channel::text = $6`,
    [
      payload.message_id,
      event.workspace_id,
      payload.external_id,
      event.occurred_at,
      JSON.stringify({
        sent_event_id: event.id,
        send_external_id: payload.external_id,
      }),
      payload.channel,
      payload.channel_account_id ?? null,
    ],
  );
}

async function projectMessageDeferred(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"message.deferred">>,
): Promise<void> {
  const payload = event.payload;
  const notes = {
    defer_reason: payload.defer_reason,
    defer_detail: payload.detail ?? null,
    defer_event_id: event.id,
  };
  await pool.query(
    `update messages
        set status = case
              when status::text in ('sent', 'delivered', 'bounced', 'replied')
                then status
              else 'deferred'::message_status
            end,
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $3::jsonb,
            properties = properties || $3::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'
        and channel::text = $4`,
    [payload.message_id, event.workspace_id, JSON.stringify(notes), payload.channel],
  );
}
