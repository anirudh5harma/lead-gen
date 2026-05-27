-- Journal-to-delivery handoff for the production NATS bus.
-- Appending an event and enqueueing its delivery happen in one transaction;
-- a worker can redrive pending delivery safely using the canonical event id.

create table event_nats_dispatches (
  event_id        uuid primary key references events(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  status          text not null default 'pending'
                    check (status in ('pending', 'delivered')),
  attempts        integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index event_nats_dispatches_pending_idx
  on event_nats_dispatches (next_attempt_at, created_at)
  where status = 'pending';

alter table event_nats_dispatches enable row level security;

create policy event_nats_dispatches_member_select on event_nats_dispatches
  for select using (is_workspace_member(workspace_id));

create policy event_nats_dispatches_admin_write on event_nats_dispatches
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
