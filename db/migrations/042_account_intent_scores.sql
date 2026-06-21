-- 042_account_intent_scores.sql
-- Account-level intent read model keyed to graph_companies. Projectors update
-- this table on signal lifecycle events; queries can rank accounts without
-- scanning every live signal on every request.

create table account_intent_scores (
  workspace_id               uuid not null references workspaces(id) on delete cascade,
  company_id                 uuid not null references graph_companies(id) on delete cascade,
  normalized_domain          citext,
  composite_score            numeric(12,6) not null default 0,
  live_signal_count          integer not null default 0,
  strongest_signal_score     numeric(12,6) not null default 0,
  latest_signal_freshness_at timestamptz,
  last_score_event_id        uuid references events(id) on delete set null,
  updated_at                 timestamptz not null default now(),

  primary key (workspace_id, company_id)
);

create index account_intent_scores_workspace_score_idx
  on account_intent_scores (workspace_id, composite_score desc, latest_signal_freshness_at desc);

create index account_intent_scores_domain_idx
  on account_intent_scores (workspace_id, normalized_domain)
  where normalized_domain is not null;

alter table account_intent_scores enable row level security;

create policy account_intent_scores_member_all on account_intent_scores
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

comment on table account_intent_scores is
  'Signal-driven account intent read model derived from live signals linked to graph_companies.';
