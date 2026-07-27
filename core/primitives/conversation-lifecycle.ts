import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const CONVERSATION_LIFECYCLE_PROJECTION = "primitive.conversation_lifecycle.v1";

type ConversationOpenedEvent = PublishedEvent<EventPayload<"conversation.opened">>;
type ConversationSignalAttachedEvent = PublishedEvent<
  EventPayload<"conversation.signal.attached">
>;

export function createConversationLifecycleProjection(pool: Pool): DurableEventProjection {
  return {
    name: CONVERSATION_LIFECYCLE_PROJECTION,
    eventTypes: ["conversation.opened", "conversation.signal.attached"],
    apply: (event) => projectConversationLifecycleEvent(pool, event),
  };
}

export async function projectConversationLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type === "conversation.opened") {
    await projectConversationOpened(pool, event as ConversationOpenedEvent);
    return;
  }
  if (event.event_type === "conversation.signal.attached") {
    await projectConversationSignalAttached(
      pool,
      event as ConversationSignalAttachedEvent,
    );
  }
}

async function projectConversationOpened(
  pool: Pool,
  event: ConversationOpenedEvent,
): Promise<void> {
  const payload = event.payload;
  const existing = await pool.query<{ id: string }>(
    `select id
       from conversations
      where workspace_id = $1
        and (
          id = $2
          or (
            counterparty_person_id = $4
            and counterparty_company_id is not distinct from $5::uuid
          )
        )
      order by case when id = $2 then 0 else 1 end
      limit 1`,
    [
      event.workspace_id,
      payload.conversation_id,
      payload.counterparty_person_id,
      payload.counterparty_company_id ?? null,
    ],
  );
  const conversationId = existing.rows[0]?.id ?? payload.conversation_id;
  const properties = {
    ...(payload.properties ?? {}),
    conversation_opened_event_id: event.id,
    requested_conversation_id: payload.conversation_id,
  };
  await pool.query(
    `insert into conversations (
       id, workspace_id, rep_id, counterparty_person_id,
       counterparty_company_id, origin_signal_id, topic, status,
       properties, started_at, last_activity_at
     ) values (
       $1, $2, $3, $4,
       $5::uuid, $6::uuid, $7, 'open',
       $8::jsonb, $9::timestamptz, $9::timestamptz
     )
     on conflict (id) do update set
       rep_id = excluded.rep_id,
       counterparty_person_id = excluded.counterparty_person_id,
       counterparty_company_id = coalesce(conversations.counterparty_company_id, excluded.counterparty_company_id),
       origin_signal_id = coalesce(conversations.origin_signal_id, excluded.origin_signal_id),
       topic = coalesce(conversations.topic, excluded.topic),
       properties = conversations.properties || excluded.properties,
       last_activity_at = greatest(conversations.last_activity_at, excluded.last_activity_at)
     where conversations.workspace_id = excluded.workspace_id`,
    [
      conversationId,
      event.workspace_id,
      payload.rep_id,
      payload.counterparty_person_id,
      payload.counterparty_company_id ?? null,
      payload.origin_signal_id,
      payload.topic ?? null,
      JSON.stringify(properties),
      payload.opened_at ?? event.occurred_at,
    ],
  );
}

async function projectConversationSignalAttached(
  pool: Pool,
  event: ConversationSignalAttachedEvent,
): Promise<void> {
  const payload = event.payload;
  await pool.query(
    `insert into conversation_signals (
       workspace_id, conversation_id, signal_id, role, reason,
       score, attached_at, properties
     ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
     on conflict (workspace_id, conversation_id, signal_id) do update set
       role = case
         when conversation_signals.role = 'primary' then conversation_signals.role
         else excluded.role
       end,
       reason = excluded.reason,
       score = coalesce(excluded.score, conversation_signals.score),
       attached_at = least(conversation_signals.attached_at, excluded.attached_at),
       properties = conversation_signals.properties || excluded.properties`,
    [
      event.workspace_id,
      payload.conversation_id,
      payload.signal_id,
      payload.role,
      payload.reason,
      payload.score ?? null,
      payload.attached_at,
      JSON.stringify({ attached_event_id: event.id }),
    ],
  );
}
