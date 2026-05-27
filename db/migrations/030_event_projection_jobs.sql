-- 018_event_projection_jobs.sql
-- Durable catch-up queue for read-model/projector consumers of the append-only
-- typed event log. LISTEN/NOTIFY provides low-latency wakeups, but it is not a
-- durable delivery acknowledgement: consumers must recover missed events
-- after process restarts and transient listener disconnects.

create table event_projection_jobs (
  projection_name     text not null,
  event_id            uuid not null references events(id) on delete restrict,
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  event_type          text not null,

  status              text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  attempt_count       integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  lease_owner         text,
  lease_expires_at    timestamptz,
  last_error          jsonb,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,

  primary key (projection_name, event_id)
);

create index event_projection_jobs_runnable_idx
  on event_projection_jobs (projection_name, status, next_attempt_at, created_at)
  where status in ('pending', 'running', 'failed');

create index event_projection_jobs_workspace_idx
  on event_projection_jobs (workspace_id, status, updated_at desc);

alter table event_projection_jobs enable row level security;

create policy epj_member_all on event_projection_jobs
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

comment on table event_projection_jobs is
  'Durable projection deliveries for typed events; enables catch-up after missed LISTEN/NOTIFY wakeups.';
