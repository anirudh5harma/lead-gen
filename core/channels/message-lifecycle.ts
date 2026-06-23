import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const MESSAGE_LIFECYCLE_PROJECTION = "channel.message_lifecycle.v1";

type MessageLifecycleEvent =
  | PublishedEvent<EventPayload<"draft.proposed">>
  | PublishedEvent<EventPayload<"draft.judged">>
  | PublishedEvent<EventPayload<"draft.rejected">>
  | PublishedEvent<EventPayload<"message.queued">>
  | PublishedEvent<EventPayload<"message.sent">>
  | PublishedEvent<EventPayload<"message.deferred">>
  | PublishedEvent<EventPayload<"message.delivered">>
  | PublishedEvent<EventPayload<"message.bounced">>;

export function createMessageLifecycleProjection(pool: Pool): DurableEventProjection {
  return {
    name: MESSAGE_LIFECYCLE_PROJECTION,
    eventTypes: [
      "draft.proposed",
      "draft.judged",
      "draft.rejected",
      "message.queued",
      "message.sent",
      "message.deferred",
      "message.delivered",
      "message.bounced",
    ],
    apply: (event) => projectMessageLifecycleEvent(pool, event),
  };
}

export async function projectMessageLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type === "draft.proposed") {
    await projectDraftProposed(
      pool,
      event as PublishedEvent<EventPayload<"draft.proposed">>,
    );
  } else if (event.event_type === "draft.judged") {
    await projectDraftJudged(
      pool,
      event as PublishedEvent<EventPayload<"draft.judged">>,
    );
  } else if (event.event_type === "draft.rejected") {
    await projectDraftRejected(
      pool,
      event as PublishedEvent<EventPayload<"draft.rejected">>,
    );
  } else if (event.event_type === "message.queued") {
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
  } else if (event.event_type === "message.delivered") {
    await projectMessageDelivered(
      pool,
      event as PublishedEvent<EventPayload<"message.delivered">>,
    );
  } else if (event.event_type === "message.bounced") {
    await projectMessageBounced(
      pool,
      event as PublishedEvent<EventPayload<"message.bounced">>,
    );
  }
}

async function projectDraftProposed(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"draft.proposed">>,
): Promise<void> {
  const payload = event.payload;
  const properties = {
    ...(payload.properties ?? {}),
    draft_proposed_event_id: event.id,
    rep_id: payload.rep_id,
  };
  await pool.query(
    `insert into messages (
       id, workspace_id, conversation_id, channel, direction, status,
       subject, body, body_html, provenance, properties, created_at
     ) values (
       $1, $2, $3, $4::message_channel, 'outbound', 'draft',
       $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz
     )
     on conflict (id) do update set
       conversation_id = excluded.conversation_id,
       channel = excluded.channel,
       subject = coalesce(excluded.subject, messages.subject),
       body = coalesce(excluded.body, messages.body),
       body_html = coalesce(excluded.body_html, messages.body_html),
       provenance = messages.provenance || excluded.provenance,
       properties = messages.properties || excluded.properties
     where messages.workspace_id = excluded.workspace_id
       and messages.direction = 'outbound'`,
    [
      payload.message_id,
      event.workspace_id,
      payload.conversation_id,
      payload.channel,
      payload.subject ?? null,
      payload.body ?? null,
      payload.body_html ?? null,
      JSON.stringify(payload.provenance ?? {}),
      JSON.stringify(properties),
      payload.proposed_at ?? event.occurred_at,
    ],
  );
}

async function projectDraftJudged(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"draft.judged">>,
): Promise<void> {
  const payload = event.payload;
  const notes = payload.notes ?? {};
  await pool.query(
    `update messages
        set eval_score = $3,
            eval_passed = $4,
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $5::jsonb,
            properties = properties || $6::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'`,
    [
      payload.message_id,
      event.workspace_id,
      payload.eval_score,
      payload.passed,
      JSON.stringify(notes),
      JSON.stringify({ draft_judged_event_id: event.id }),
    ],
  );
}

async function projectDraftRejected(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"draft.rejected">>,
): Promise<void> {
  const payload = event.payload;
  const notes = {
    draft_rejection_reason: payload.reason,
    draft_rejected_event_id: event.id,
  };
  await pool.query(
    `update messages
        set eval_notes = coalesce(eval_notes, '{}'::jsonb) || $3::jsonb,
            properties = properties || $3::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'`,
    [payload.message_id, event.workspace_id, JSON.stringify(notes)],
  );
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
            channel_account_id = coalesce($5::uuid, channel_account_id),
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $3::jsonb,
            properties = properties || $6::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'
        and channel::text = $4`,
    [
      payload.message_id,
      event.workspace_id,
      JSON.stringify(notes),
      payload.channel,
      payload.channel_account_id ?? null,
      JSON.stringify({
        ...notes,
        retry_after: payload.retry_after ?? null,
      }),
    ],
  );
}

async function projectMessageDelivered(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"message.delivered">>,
): Promise<void> {
  const payload = event.payload;
  await pool.query(
    `update messages
        set status = case
              when status::text in ('bounced', 'replied')
                then status
              else 'delivered'::message_status
            end,
            delivered_at = coalesce(delivered_at, $3::timestamptz),
            properties = properties || $4::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'
        and channel::text = $5`,
    [
      payload.message_id,
      event.workspace_id,
      event.occurred_at,
      JSON.stringify({
        delivered_event_id: event.id,
        delivery_external_id: payload.external_id ?? null,
        delivery_provider_event_id: payload.provider_event_id ?? null,
      }),
      payload.channel,
    ],
  );
}

async function projectMessageBounced(
  pool: Pool,
  event: MessageLifecycleEvent & PublishedEvent<EventPayload<"message.bounced">>,
): Promise<void> {
  const payload = event.payload;
  const notes = {
    bounce_type: payload.bounce_type,
    bounce_reason: payload.reason ?? null,
    bounce_recipient: payload.recipient ?? null,
    bounce_detail: payload.detail ?? null,
    bounce_event_id: event.id,
    delivery_external_id: payload.external_id ?? null,
    delivery_provider_event_id: payload.provider_event_id ?? null,
  };
  await pool.query(
    `update messages
        set status = 'bounced'::message_status,
            eval_notes = coalesce(eval_notes, '{}'::jsonb) || $3::jsonb,
            properties = properties || $3::jsonb
      where id = $1
        and workspace_id = $2
        and direction = 'outbound'
        and channel::text = $4`,
    [payload.message_id, event.workspace_id, JSON.stringify(notes), payload.channel],
  );
}
