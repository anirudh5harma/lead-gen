-- 002_substrate_events.sql
-- Append-only typed event log. Every state change in the system emits a row
-- here. This is the durable backing store for the event bus
-- (core/substrate/events/). Handlers MUST NOT write to other tables without
-- emitting a corresponding event.

create table events (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  -- Typed event name, e.g. 'signal.ingested', 'draft.proposed',
  -- 'message.sent', 'reply.classified', 'outcome.scored'.
  event_type        text not null,
  schema_version    smallint not null default 1,

  -- Causation graph for replay and forensics. Both nullable for genesis events.
  correlation_id    uuid,
  causation_id      uuid,

  -- Producer attribution.
  source            text not null check (source in ('system', 'agent', 'user', 'webhook', 'cron')),
  producer_ref      text,                    -- e.g. 'rep:<uuid>', 'channel:email', 'webhook:gmail'

  payload           jsonb not null,
  occurred_at       timestamptz not null default now()
);

-- Hot path: workspace-scoped time ordering.
create index events_workspace_occurred_idx
  on events (workspace_id, occurred_at desc);

-- Replay by type (e.g. rebuild a projection).
create index events_type_occurred_idx
  on events (event_type, occurred_at desc);

-- Causation traversal (find everything that descended from a root event).
create index events_correlation_idx
  on events (correlation_id)
  where correlation_id is not null;

create index events_causation_idx
  on events (causation_id)
  where causation_id is not null;

-- Enforce append-only at the table level. Updates/deletes are blocked by
-- RLS in 012_rls_policies.sql; the trigger here is belt-and-braces against
-- privileged roles that bypass RLS.
create or replace function events_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'events is append-only (op=%, id=%)', tg_op, coalesce(old.id, new.id);
end;
$$;

create trigger events_no_update
  before update on events
  for each row execute function events_block_mutation();

create trigger events_no_delete
  before delete on events
  for each row execute function events_block_mutation();

comment on table events is
  'Append-only typed event log. The only inter-component contract in pivot-v2. See core/substrate/events/.';
