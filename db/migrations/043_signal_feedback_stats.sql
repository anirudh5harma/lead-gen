-- 043_signal_feedback_stats.sql
-- Outcome-driven read model for signal learning. Stores per-source/per-kind
-- conversion evidence at workspace scope, with nullable workspace_id rows for
-- global fallback when a workspace has no local history yet.

create table signal_feedback_stats (
  workspace_id        uuid references workspaces(id) on delete cascade,
  source              text not null,
  signal_kind         signal_kind not null,
  positive_outcomes   integer not null default 0 check (positive_outcomes >= 0),
  signals_surfaced    integer not null default 0 check (signals_surfaced >= 0),
  learned_modifier    double precision not null default 1.0
                        check (learned_modifier >= 0.5 and learned_modifier <= 1.5),
  last_event_id       uuid references events(id) on delete set null,
  updated_at          timestamptz not null default now()
);

create index signal_feedback_stats_workspace_source_kind_idx
  on signal_feedback_stats (workspace_id, source, signal_kind);

create unique index signal_feedback_stats_workspace_unique_idx
  on signal_feedback_stats (workspace_id, source, signal_kind)
  where workspace_id is not null;

create unique index signal_feedback_stats_global_unique_idx
  on signal_feedback_stats (source, signal_kind)
  where workspace_id is null;

alter table signal_feedback_stats enable row level security;

create policy signal_feedback_stats_member_all on signal_feedback_stats
  for all using (workspace_id is null or is_workspace_member(workspace_id))
  with check (workspace_id is null or is_workspace_member(workspace_id));

comment on table signal_feedback_stats is
  'Outcome-driven signal conversion feedback by source and signal kind, with workspace rows and global fallback rows.';
