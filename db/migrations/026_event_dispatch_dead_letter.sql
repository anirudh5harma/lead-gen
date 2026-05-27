-- 026_event_dispatch_dead_letter.sql
-- Add a dead-letter state to the NATS dispatch table so that events whose
-- delivery has failed beyond the configured retry ceiling stop being
-- redriven automatically and surface in the operator dashboard for
-- manual triage / requeue.

alter table event_nats_dispatches
  drop constraint if exists event_nats_dispatches_status_check;

alter table event_nats_dispatches
  add constraint event_nats_dispatches_status_check
  check (status in ('pending', 'delivered', 'dead_lettered'));

alter table event_nats_dispatches
  add column if not exists dead_lettered_at timestamptz;

create index if not exists event_nats_dispatches_dead_lettered_idx
  on event_nats_dispatches (workspace_id, dead_lettered_at desc)
  where status = 'dead_lettered';
