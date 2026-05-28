-- 032_supabase_hardening.sql
-- Close the first Supabase advisor pass after the pivot-v2 clean-slate
-- migration: lock helper function search paths, finish RLS coverage, tighten
-- shared-catalog write checks, move extensions out of public, and add FK
-- indexes used by deletes/updates and projector joins.

create schema if not exists extensions;

alter extension citext set schema extensions;
alter extension vector set schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;

alter function public.current_user_id()
  set search_path = public, pg_catalog;
alter function public.is_workspace_member(uuid)
  set search_path = public, pg_catalog;
alter function public.is_workspace_admin(uuid)
  set search_path = public, pg_catalog;
alter function public.events_block_mutation()
  set search_path = public, pg_catalog;
alter function public.events_notify_trigger()
  set search_path = public, pg_catalog;

alter table if exists public.schema_migrations enable row level security;
alter table if exists public.workflow_event_waits enable row level security;

drop policy if exists workflow_event_waits_member_select on public.workflow_event_waits;
drop policy if exists workflow_event_waits_admin_insert on public.workflow_event_waits;
drop policy if exists workflow_event_waits_admin_update on public.workflow_event_waits;
drop policy if exists workflow_event_waits_admin_delete on public.workflow_event_waits;

create policy workflow_event_waits_member_select on public.workflow_event_waits
  for select using (is_workspace_member(workspace_id));
create policy workflow_event_waits_admin_insert on public.workflow_event_waits
  for insert with check (is_workspace_admin(workspace_id));
create policy workflow_event_waits_admin_update on public.workflow_event_waits
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy workflow_event_waits_admin_delete on public.workflow_event_waits
  for delete using (is_workspace_admin(workspace_id));

-- Split broad admin-write policies into write-only policies so SELECT does not
-- overlap with the member SELECT policies, and remove WITH CHECK (true).

drop policy if exists ws_members_admin_write on public.workspace_members;
create policy ws_members_admin_insert on public.workspace_members
  for insert with check (is_workspace_admin(workspace_id));
create policy ws_members_admin_update on public.workspace_members
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy ws_members_admin_delete on public.workspace_members
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists ca_admin_write on public.channel_accounts;
create policy ca_admin_insert on public.channel_accounts
  for insert with check (is_workspace_admin(workspace_id));
create policy ca_admin_update on public.channel_accounts
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy ca_admin_delete on public.channel_accounts
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists sd_admin_write on public.sending_domains;
create policy sd_admin_insert on public.sending_domains
  for insert with check (is_workspace_admin(workspace_id));
create policy sd_admin_update on public.sending_domains
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy sd_admin_delete on public.sending_domains
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists event_nats_dispatches_admin_write on public.event_nats_dispatches;
create policy event_nats_dispatches_admin_insert on public.event_nats_dispatches
  for insert with check (is_workspace_admin(workspace_id));
create policy event_nats_dispatches_admin_update on public.event_nats_dispatches
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy event_nats_dispatches_admin_delete on public.event_nats_dispatches
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists ovf_admin_write on public.signal_overflow;
create policy ovf_admin_insert on public.signal_overflow
  for insert with check (is_workspace_admin(workspace_id));
create policy ovf_admin_update on public.signal_overflow
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy ovf_admin_delete on public.signal_overflow
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists fanouts_admin_write on public.signal_candidate_fanouts;
create policy fanouts_admin_insert on public.signal_candidate_fanouts
  for insert with check (is_workspace_admin(workspace_id));
create policy fanouts_admin_update on public.signal_candidate_fanouts
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy fanouts_admin_delete on public.signal_candidate_fanouts
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists workspace_llm_usage_admin_write on public.workspace_llm_usage;
create policy workspace_llm_usage_admin_insert on public.workspace_llm_usage
  for insert with check (is_workspace_admin(workspace_id));
create policy workspace_llm_usage_admin_update on public.workspace_llm_usage
  for update using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy workspace_llm_usage_admin_delete on public.workspace_llm_usage
  for delete using (is_workspace_admin(workspace_id));

drop policy if exists tracked_companies_admin_write on public.tracked_companies;
create policy tracked_companies_admin_insert on public.tracked_companies
  for insert with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy tracked_companies_admin_update on public.tracked_companies
  for update using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy tracked_companies_admin_delete on public.tracked_companies
  for delete using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );

drop policy if exists candidates_admin_write on public.signal_candidates;
create policy candidates_admin_insert on public.signal_candidates
  for insert with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy candidates_admin_update on public.signal_candidates
  for update using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy candidates_admin_delete on public.signal_candidates
  for delete using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );

drop policy if exists psl_admin_write on public.platform_signal_sources;
create policy psl_admin_insert on public.platform_signal_sources
  for insert with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy psl_admin_update on public.platform_signal_sources
  for update using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy psl_admin_delete on public.platform_signal_sources
  for delete using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );

drop policy if exists cpc_admin_write on public.catalog_poll_cursors;
create policy cpc_admin_insert on public.catalog_poll_cursors
  for insert with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy cpc_admin_update on public.catalog_poll_cursors
  for update using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );
create policy cpc_admin_delete on public.catalog_poll_cursors
  for delete using (
    exists (
      select 1
      from public.workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  );

create index if not exists catalog_poll_cursors_company_fk_idx
  on public.catalog_poll_cursors (company_id);
create index if not exists conversations_counterparty_company_fk_idx
  on public.conversations (counterparty_company_id);
create index if not exists conversations_counterparty_person_fk_idx
  on public.conversations (counterparty_person_id);
create index if not exists conversations_origin_signal_fk_idx
  on public.conversations (origin_signal_id);
create index if not exists conversations_rep_fk_idx
  on public.conversations (rep_id);
create index if not exists event_projection_jobs_event_fk_idx
  on public.event_projection_jobs (event_id);
create index if not exists graph_persons_company_fk_idx
  on public.graph_persons (company_id);
create index if not exists messages_channel_account_fk_idx
  on public.messages (channel_account_id);
create index if not exists messages_conversation_fk_idx
  on public.messages (conversation_id);
create index if not exists outcomes_attributed_message_fk_idx
  on public.outcomes (attributed_message_id);
create index if not exists outcomes_attributed_play_fk_idx
  on public.outcomes (attributed_play_id);
create index if not exists outcomes_attributed_play_run_fk_idx
  on public.outcomes (attributed_play_run_id);
create index if not exists outcomes_attributed_rep_fk_idx
  on public.outcomes (attributed_rep_id);
create index if not exists outcomes_attributed_signal_fk_idx
  on public.outcomes (attributed_signal_id);
create index if not exists outcomes_conversation_fk_idx
  on public.outcomes (conversation_id);
create index if not exists outcomes_subject_company_fk_idx
  on public.outcomes (subject_company_id);
create index if not exists outcomes_subject_person_fk_idx
  on public.outcomes (subject_person_id);
create index if not exists play_runs_play_fk_idx
  on public.play_runs (play_id);
create index if not exists play_runs_rep_fk_idx
  on public.play_runs (rep_id);
create index if not exists play_runs_trigger_event_fk_idx
  on public.play_runs (trigger_event_id);
create index if not exists plays_default_rep_fk_idx
  on public.plays (default_rep_id);
create index if not exists rep_memory_episodic_rep_fk_idx
  on public.rep_memory_episodic (rep_id);
create index if not exists rep_memory_procedural_rep_fk_idx
  on public.rep_memory_procedural (rep_id);
create index if not exists rep_memory_procedural_apps_rep_fk_idx
  on public.rep_memory_procedural_applications (rep_id);
create index if not exists rep_memory_semantic_rep_fk_idx
  on public.rep_memory_semantic (rep_id);
create index if not exists sending_domains_channel_account_fk_idx
  on public.sending_domains (channel_account_id);
create index if not exists signals_related_company_fk_idx
  on public.signals (related_company_id);
create index if not exists signals_related_person_fk_idx
  on public.signals (related_person_id);
create index if not exists signals_source_fk_idx
  on public.signals (source_id);
create index if not exists workflow_approvals_run_fk_idx
  on public.workflow_approvals (run_id);
create index if not exists workflow_approvals_step_fk_idx
  on public.workflow_approvals (step_id);
create index if not exists workflow_checkpoints_workspace_fk_idx
  on public.workflow_checkpoints (workspace_id);
create index if not exists workflow_event_waits_matched_event_fk_idx
  on public.workflow_event_waits (matched_event_id);
create index if not exists workflow_runs_play_fk_idx
  on public.workflow_runs (play_id);
create index if not exists workflow_runs_play_run_fk_idx
  on public.workflow_runs (play_run_id);
create index if not exists workspace_source_configs_source_fk_idx
  on public.workspace_source_configs (source_id);
create index if not exists workspace_tracked_companies_company_fk_idx
  on public.workspace_tracked_companies (company_id);
