-- 017_platform_signal_sources.sql
-- Refinement A's missing piece: a workspace-AGNOSTIC source registry for
-- catalog-driven adapters (Greenhouse / Lever / Ashby / Workable / SEC EDGAR).
-- One `platform_signal_sources` row per adapter; the catalog-poll workflow
-- iterates `tracked_companies` filtered by ATS id and polls once per
-- (source, company) regardless of how many workspaces care.
--
-- graph_sources remains as the per-workspace source registry for
-- workspace-driven adapters (custom RSS feeds, keyword searches) — those
-- write directly into the workspace's `signals` and bypass the shared
-- candidates pool.

create table platform_signal_sources (
  id          uuid primary key default gen_random_uuid(),
  /** Adapter identifier — must match a key in core/ingest/adapters/registry.
      Examples: 'greenhouse', 'lever', 'ashby', 'workable', 'sec_edgar',
      'hn_front', 'hn_whos_hiring', 'product_hunt', 'rss'. */
  adapter     text not null,
  /** Human-readable label for ops + dashboards. */
  name        text not null,
  /** Adapter-specific defaults (e.g. base URL overrides). */
  config      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

create unique index platform_signal_sources_adapter_idx
  on platform_signal_sources (adapter);

-- Per-(source, company) cursor state for catalog polls. The poll workflow
-- writes the upstream's "give me items since X" cursor here; the next
-- poll resumes from it.
create table catalog_poll_cursors (
  source_id      uuid not null references platform_signal_sources(id) on delete cascade,
  company_id     uuid not null references tracked_companies(id) on delete cascade,
  cursor         jsonb not null default '{}'::jsonb,
  last_polled_at timestamptz,
  last_error     jsonb,
  /** Adapter records the set of external_ids returned on the last poll so
      the expiration sweep can diff against the next poll. */
  last_external_ids text[] not null default array[]::text[],
  primary key (source_id, company_id)
);

create index catalog_poll_cursors_due_idx
  on catalog_poll_cursors (last_polled_at nulls first);

-- Re-point signal_candidates.source_id at platform_signal_sources.
-- (Foundation has no production data so the data move is trivial.)
alter table signal_candidates
  drop constraint signal_candidates_source_id_fkey;

alter table signal_candidates
  add constraint signal_candidates_source_id_fkey
  foreign key (source_id) references platform_signal_sources(id) on delete cascade;

-- RLS for the new tables. Both are platform-shared state — readable by any
-- authenticated workspace member, writable by admins. Production should
-- restrict writes further to a platform service role.

alter table platform_signal_sources enable row level security;
alter table catalog_poll_cursors    enable row level security;

create policy psl_member_select on platform_signal_sources
  for select using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id() and wm.accepted_at is not null
    )
  );
create policy psl_admin_write on platform_signal_sources
  for all using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (true);

create policy cpc_member_select on catalog_poll_cursors
  for select using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id() and wm.accepted_at is not null
    )
  );
create policy cpc_admin_write on catalog_poll_cursors
  for all using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (true);

-- ───────────────────────────────────────────────────────────────────────────
-- New typed event: signal.expired. Emitted when a catalog candidate flips
-- from 'active' to 'expired' (the upstream stops surfacing the external_id —
-- a job filled, a press release pulled). Downstream Plays use this to stop
-- referencing stale opportunities.
--
-- The event is registered in code (core/substrate/events/registry.ts).
-- The schema lives in `events` (already typed-jsonb). This migration is
-- only data-shape; no DDL needed for the event itself.
-- ───────────────────────────────────────────────────────────────────────────
