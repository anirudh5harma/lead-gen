-- 024_workflow_event_waits.sql
-- Durable typed-event signal bridge for Restate-hosted workflows.
--
-- Restate owns workflow suspension/resume. This table owns the auditable
-- routing contract between the typed event bus and workflow-bound durable
-- promises so ctx.awaitEvent remains visible and redrivable in production.

create type workflow_event_wait_status as enum (
  'waiting',
  'delivering',
  'delivered',
  'consumed',
  'cancelled'
);

create table workflow_event_waits (
  id                   text primary key,
  workspace_id         uuid not null references workspaces(id) on delete cascade,

  workflow_name        text not null,
  workflow_key         text not null,
  run_id               text not null,

  event_type           text not null,
  promise_name         text not null,
  status               workflow_event_wait_status not null default 'waiting',

  matched_event_id     uuid references events(id) on delete set null,
  delivered_payload    jsonb,
  last_error           text,

  created_at           timestamptz not null default now(),
  delivered_at         timestamptz,
  consumed_at          timestamptz
);

create unique index workflow_event_waits_promise_idx
  on workflow_event_waits (workspace_id, workflow_name, workflow_key, promise_name);

create index workflow_event_waits_waiting_idx
  on workflow_event_waits (workspace_id, event_type, created_at)
  where status = 'waiting';

create index workflow_event_waits_delivery_retry_idx
  on workflow_event_waits (delivered_at)
  where status = 'delivering';
