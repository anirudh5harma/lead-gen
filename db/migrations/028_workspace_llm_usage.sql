-- 015_workspace_llm_usage.sql
-- Per-workspace LLM usage ledger for cost / rate-limit governance. This is
-- append-only operational state, not a queue. Runtime gates read it before
-- model calls and emit typed events when usage is recorded or deferred.

create table workspace_llm_usage (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  purpose             text not null,
  model               text not null,
  prompt_tokens       integer not null default 0,
  completion_tokens   integer not null default 0,
  total_tokens        integer not null default 0,
  estimated_cost_usd  numeric(12,6),
  properties          jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create index workspace_llm_usage_workspace_day_idx
  on workspace_llm_usage (workspace_id, created_at desc);

alter table workspace_llm_usage enable row level security;

create policy workspace_llm_usage_member_select on workspace_llm_usage
  for select using (is_workspace_member(workspace_id));

create policy workspace_llm_usage_admin_write on workspace_llm_usage
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
