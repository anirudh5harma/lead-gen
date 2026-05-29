import type { Pool } from "pg";
import type {
  DurableEventProjection,
  EventPayload,
  PublishedEvent,
} from "../substrate/events/index.ts";

export const OUTCOME_LIFECYCLE_PROJECTION = "primitive.outcome_lifecycle.v1";

type OutcomeRecordedEvent = PublishedEvent<EventPayload<"outcome.recorded">>;

export function createOutcomeLifecycleProjection(pool: Pool): DurableEventProjection {
  return {
    name: OUTCOME_LIFECYCLE_PROJECTION,
    eventTypes: ["outcome.recorded"],
    apply: (event) => projectOutcomeLifecycleEvent(pool, event),
  };
}

export async function projectOutcomeLifecycleEvent(
  pool: Pool,
  event: PublishedEvent,
): Promise<void> {
  if (event.event_type !== "outcome.recorded") return;
  await projectOutcomeRecorded(pool, event as OutcomeRecordedEvent);
}

async function projectOutcomeRecorded(
  pool: Pool,
  event: OutcomeRecordedEvent,
): Promise<void> {
  const payload = event.payload;
  const provenance = {
    ...(payload.provenance ?? {}),
    outcome_event_id: event.id,
  };
  await pool.query(
    `insert into outcomes (
       id, workspace_id, kind, score,
       conversation_id, attributed_message_id, attributed_signal_id,
       attributed_play_id, attributed_play_run_id, attributed_rep_id,
       subject_person_id, subject_company_id,
       properties, provenance, occurred_at, recorded_at
     ) values (
       $1, $2, $3::outcome_kind, $4,
       $5::uuid, $6::uuid, $7::uuid,
       $8::uuid, $9::uuid, $10::uuid,
       $11::uuid, $12::uuid,
       $13::jsonb, $14::jsonb, $15::timestamptz, $16::timestamptz
     )
     on conflict (id) do update set
       kind = excluded.kind,
       score = excluded.score,
       conversation_id = excluded.conversation_id,
       attributed_message_id = excluded.attributed_message_id,
       attributed_signal_id = excluded.attributed_signal_id,
       attributed_play_id = excluded.attributed_play_id,
       attributed_play_run_id = excluded.attributed_play_run_id,
       attributed_rep_id = excluded.attributed_rep_id,
       subject_person_id = excluded.subject_person_id,
       subject_company_id = excluded.subject_company_id,
       properties = outcomes.properties || excluded.properties,
       provenance = outcomes.provenance || excluded.provenance,
       occurred_at = excluded.occurred_at
     where outcomes.workspace_id = excluded.workspace_id`,
    [
      payload.outcome_id,
      event.workspace_id,
      payload.kind,
      payload.score,
      payload.conversation_id,
      payload.attributed_message_id ?? null,
      payload.attributed_signal_id ?? null,
      payload.attributed_play_id,
      payload.attributed_play_run_id ?? null,
      payload.attributed_rep_id ?? null,
      payload.subject_person_id ?? null,
      payload.subject_company_id ?? null,
      JSON.stringify(payload.properties ?? {}),
      JSON.stringify(provenance),
      payload.occurred_at ?? event.occurred_at,
      event.occurred_at,
    ],
  );
}
