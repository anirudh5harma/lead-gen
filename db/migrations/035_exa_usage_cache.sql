-- 035_exa_usage_cache.sql
-- Workspace-scoped Exa cache and usage ledger. Direct Exa research/profile
-- calls use this substrate so public-web intelligence can be governed without
-- hiding provenance from the event bus or knowledge graph.

create table workspace_exa_usage (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  event_id           uuid references events(id) on delete set null,
  intent             text not null,
  operation          text not null,
  query_hash         text,
  request_id         text,
  result_count       integer not null default 0,
  estimated_units    numeric(12,4) not null default 0,
  properties         jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index workspace_exa_usage_workspace_time_idx
  on workspace_exa_usage (workspace_id, created_at desc);

create index workspace_exa_usage_workspace_intent_time_idx
  on workspace_exa_usage (workspace_id, intent, created_at desc);

create table workspace_exa_query_cache (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  intent             text not null,
  query_hash         text not null,
  query              text not null,
  search_options     jsonb not null default '{}'::jsonb,
  request_id         text,
  result_count       integer not null default 0,
  response           jsonb not null,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, intent, query_hash)
);

create index workspace_exa_query_cache_lookup_idx
  on workspace_exa_query_cache (workspace_id, intent, query_hash, expires_at);

create table workspace_exa_content_cache (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  canonical_url      text not null,
  exa_result_id      text,
  title              text,
  summary            text,
  text_excerpt       text,
  highlights         text[] not null default array[]::text[],
  request_id         text,
  raw                jsonb not null default '{}'::jsonb,
  expires_at         timestamptz not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (workspace_id, canonical_url)
);

create index workspace_exa_content_cache_lookup_idx
  on workspace_exa_content_cache (workspace_id, canonical_url, expires_at);

alter table workspace_exa_usage enable row level security;
alter table workspace_exa_query_cache enable row level security;
alter table workspace_exa_content_cache enable row level security;

create policy workspace_exa_usage_member_select on workspace_exa_usage
  for select using (is_workspace_member(workspace_id));

create policy workspace_exa_usage_admin_write on workspace_exa_usage
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

create policy workspace_exa_query_cache_member_select on workspace_exa_query_cache
  for select using (is_workspace_member(workspace_id));

create policy workspace_exa_query_cache_admin_write on workspace_exa_query_cache
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

create policy workspace_exa_content_cache_member_select on workspace_exa_content_cache
  for select using (is_workspace_member(workspace_id));

create policy workspace_exa_content_cache_admin_write on workspace_exa_content_cache
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
