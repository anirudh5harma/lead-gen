-- 019_procedural_memory_applications.sql
-- Exact-once state projection for Outcome-driven procedural learning. An
-- outcome may be replayed by the durable projector, but it must not train an
-- exemplar twice.

create table rep_memory_procedural_applications (
  event_id            uuid primary key references events(id) on delete restrict,
  outcome_event_id    uuid not null references events(id) on delete restrict,
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  rep_id              uuid not null references reps(id) on delete cascade,
  pattern_key         text not null,
  exemplar_ids        uuid[] not null,
  delta_score         numeric(6,4) not null,
  win                 boolean not null,
  applied_at          timestamptz not null default now(),

  unique (outcome_event_id)
);

create index rep_memory_procedural_applications_workspace_idx
  on rep_memory_procedural_applications (workspace_id, applied_at desc);

alter table rep_memory_procedural_applications enable row level security;

create policy rmpa_member_all on rep_memory_procedural_applications
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

comment on table rep_memory_procedural_applications is
  'Deduplication ledger for durable outcome-to-procedural-memory updates.';
