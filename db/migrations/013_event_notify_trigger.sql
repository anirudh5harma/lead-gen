-- 013_event_notify_trigger.sql
-- Wake real-time subscribers on the Postgres event bus.
--
-- AFTER INSERT on `events` fires NOTIFY on a single channel ('events') with
-- a small JSON payload carrying the event id + workspace_id + event_type.
-- Subscribers (`core/substrate/events/adapters/postgres.ts`) LISTEN, filter
-- in code, then SELECT the full row by id when they need it.
--
-- NOTIFY payloads are capped at ~8KB by Postgres. By sending only the id +
-- a couple of routing fields, we stay far under the cap regardless of the
-- event's payload size.

create or replace function events_notify_trigger()
returns trigger
language plpgsql
as $$
begin
  perform pg_notify(
    'events',
    json_build_object(
      'id', new.id,
      'workspace_id', new.workspace_id,
      'event_type', new.event_type
    )::text
  );
  return new;
end;
$$;

create trigger events_notify
  after insert on events
  for each row execute function events_notify_trigger();
