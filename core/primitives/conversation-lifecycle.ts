import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const CONVERSATION_LIFECYCLE_PROJECTION = "primitive.conversation_lifecycle.v1";

type ConversationOpenedEvent = PublishedEvent<EventPayload<"conversation.opened">>;

export function createConversationLifecycleProjection(pool: Pool): DurableEventProjection {
  return {
    name: CONVERSATION_LIFECYCLE_PROJECTION,
    eventTypes: ["conversation.opened"],
    apply: (event) => projectConversationLifecycleEvent(pool, event),
  };
}

export async function projectConversationLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type !== "conversation.opened") return;
  await projectConversationOpened(pool, event as ConversationOpenedEvent);
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
            $5::uuid is not null
            and rep_id = $3
            and counterparty_person_id = $4
            and origin_signal_id = $5::uuid
          )
        )
      order by case when id = $2 then 0 else 1 end
      limit 1`,
    [
      event.workspace_id,
      payload.conversation_id,
      payload.rep_id,
      payload.counterparty_person_id,
      payload.origin_signal_id,
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
       counterparty_company_id = excluded.counterparty_company_id,
       origin_signal_id = excluded.origin_signal_id,
       topic = excluded.topic,
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
