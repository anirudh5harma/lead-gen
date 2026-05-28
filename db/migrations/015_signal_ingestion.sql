-- 015_signal_ingestion.sql
-- Schema for the signal ingestion subsystem. See docs/signal-ingestion.md
-- for the full design; this migration locks the data model.
--
-- Five new tables (no changes to existing tables):
--   workspace_icps               : multiple ICP segments per workspace
--   tracked_companies            : workspace-agnostic catalog of companies
--                                  with their ATS board ids
--   workspace_tracked_companies  : per-workspace opt-ins into the catalog
--   workspace_source_configs     : per-(workspace, source) cursor + cadence
--                                  + budget state
--   workspace_ingestion_budgets  : per-workspace daily caps for candidates
--                                  and classification calls
--   signal_overflow              : audit log of items dropped due to caps

-- ───────────────────────────────────────────────────────────────────────────
-- Multiple ICP segments per workspace. Team plan surfaces a UI; foundation
-- code reads/writes via direct SQL.
-- ───────────────────────────────────────────────────────────────────────────

create table workspace_icps (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  name            text not null,
  description     text not null,                       -- prose used by the matcher LLM
  must_haves      jsonb not null default '[]'::jsonb,  -- hard filters as a list
  nice_to_haves   jsonb not null default '[]'::jsonb,
  match_threshold numeric(5,4) not null default 0.6,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index workspace_icps_workspace_name_idx
  on workspace_icps (workspace_id, lower(name));

create index workspace_icps_workspace_enabled_idx
  on workspace_icps (workspace_id) where enabled;

-- ───────────────────────────────────────────────────────────────────────────
-- Tracked-companies catalog. Workspace-AGNOSTIC. The platform maintains
-- this with seed data + periodic crawl-discovery; workspaces opt in via
-- workspace_tracked_companies below. Sharing the catalog avoids every
-- workspace re-doing the work of locating ATS board ids.
-- ───────────────────────────────────────────────────────────────────────────

create table tracked_companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  domain          citext,
  industry        text,
  size_bucket     text,
  greenhouse_id   text,    -- public board slug, e.g. 'stripe'
  lever_id        text,
  ashby_id        text,
  workable_id     text,
  career_rss_url  text,
  properties      jsonb not null default '{}'::jsonb,
  added_at        timestamptz not null default now(),
  refreshed_at    timestamptz
);

create unique index tracked_companies_domain_idx
  on tracked_companies (domain) where domain is not null;

create index tracked_companies_greenhouse_idx
  on tracked_companies (greenhouse_id) where greenhouse_id is not null;

create index tracked_companies_lever_idx
  on tracked_companies (lever_id) where lever_id is not null;

create index tracked_companies_ashby_idx
  on tracked_companies (ashby_id) where ashby_id is not null;

create index tracked_companies_industry_size_idx
  on tracked_companies (industry, size_bucket);

create table workspace_tracked_companies (
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  company_id    uuid not null references tracked_companies(id) on delete cascade,
  added_at      timestamptz not null default now(),
  added_by      uuid,
  /** Optional reason: 'explicit', 'industry:fintech+size:series-a', etc. */
  reason        text,
  primary key (workspace_id, company_id)
);

create index workspace_tracked_companies_workspace_idx
  on workspace_tracked_companies (workspace_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Per-(workspace, source) ingestion state: cursor + cadence + last poll
-- status. graph_sources is the source registry (already exists); this
-- table attaches workspace-scoped runtime state to it.
-- ───────────────────────────────────────────────────────────────────────────

create table workspace_source_configs (
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  source_id         uuid not null references graph_sources(id) on delete cascade,
  enabled           boolean not null default true,
  poll_cadence_sec  integer not null default 900,
  /** Adapter-specific overrides (e.g. additional keywords). */
  config_overrides  jsonb not null default '{}'::jsonb,
  /** Adapter-specific cursor — last_id, last_published_at, page_token, etc. */
  cursor            jsonb not null default '{}'::jsonb,
  last_polled_at    timestamptz,
  last_error        jsonb,
  primary key (workspace_id, source_id)
);

create index workspace_source_configs_enabled_idx
  on workspace_source_configs (workspace_id) where enabled;

-- ───────────────────────────────────────────────────────────────────────────
-- Daily ingestion budgets. Resets via a rolling 24h window; the
-- candidate counter throttles cheap polling, the classify counter
-- throttles LLM-bearing stage 2.
-- ───────────────────────────────────────────────────────────────────────────

create table workspace_ingestion_budgets (
  workspace_id          uuid primary key references workspaces(id) on delete cascade,
  daily_candidate_cap   integer not null default 5000,
  daily_classify_cap    integer not null default 1000,
  daily_candidates_used integer not null default 0,
  daily_classify_used   integer not null default 0,
  window_start          timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- Audit overflow. Items dropped because the daily candidate cap was hit
-- land here so we can a) prove we didn't lose them silently and b) tune
-- the cap or the cadence later.
-- ───────────────────────────────────────────────────────────────────────────

create table signal_overflow (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  source_id     uuid references graph_sources(id) on delete set null,
  reason        text not null,
  payload       jsonb not null,
  occurred_at   timestamptz not null default now()
);

create index signal_overflow_workspace_time_idx
  on signal_overflow (workspace_id, occurred_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- RLS — workspace-scoped tables follow the same pattern as 012.
-- tracked_companies is intentionally workspace-AGNOSTIC: readable by every
-- workspace member (so the UI can browse the catalog), writable only by
-- admins of any workspace (the platform's curation responsibility).
-- ───────────────────────────────────────────────────────────────────────────

alter table workspace_icps              enable row level security;
alter table workspace_tracked_companies enable row level security;
alter table workspace_source_configs    enable row level security;
alter table workspace_ingestion_budgets enable row level security;
alter table signal_overflow             enable row level security;
alter table tracked_companies           enable row level security;

create policy icps_member_all on workspace_icps
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy wtc_member_all on workspace_tracked_companies
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy wsc_member_all on workspace_source_configs
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy wib_member_all on workspace_ingestion_budgets
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy ovf_member_select on signal_overflow
  for select using (is_workspace_member(workspace_id));

create policy ovf_admin_write on signal_overflow
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

-- Catalog: readable to anyone authenticated against any workspace they
-- belong to (we don't gate by workspace because it's shared). Writable
-- only by workspace admins — production should restrict this further
-- (platform service role) once such a role lands.
create policy tracked_companies_select on tracked_companies
  for select using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id() and wm.accepted_at is not null
    )
  );
create policy tracked_companies_admin_write on tracked_companies
  for all using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  )
  with check (true);
