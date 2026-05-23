-- 012_rls_policies.sql
-- Row-level security. Workspace is the security boundary. Every tenant-scoped
-- table gets the same shape of policy:
--
--   * SELECT  : visible to workspace members
--   * INSERT  : insertable by workspace members (workspace_id must match)
--   * UPDATE  : updatable by workspace members
--   * DELETE  : restricted to admins / owners
--
-- Append-only tables (events) have no UPDATE/DELETE policies — the trigger
-- in 002 enforces this; the lack of policy is belt-and-braces.

-- Tenancy --------------------------------------------------------------------

alter table workspaces           enable row level security;
alter table workspace_members    enable row level security;

create policy ws_select on workspaces
  for select using (is_workspace_member(id));

create policy ws_admin_write on workspaces
  for update using (is_workspace_admin(id));

create policy ws_members_select on workspace_members
  for select using (is_workspace_member(workspace_id));

create policy ws_members_admin_write on workspace_members
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

-- Substrate ------------------------------------------------------------------

alter table events                enable row level security;
alter table workflow_runs         enable row level security;
alter table workflow_steps        enable row level security;
alter table workflow_checkpoints  enable row level security;
alter table workflow_approvals    enable row level security;

create policy events_member_select on events
  for select using (is_workspace_member(workspace_id));

create policy events_member_insert on events
  for insert with check (is_workspace_member(workspace_id));

-- No UPDATE / DELETE policies on events. Append-only.

create policy wfr_member_all on workflow_runs
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy wfs_member_all on workflow_steps
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy wfc_member_all on workflow_checkpoints
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy wfa_member_all on workflow_approvals
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- Graph ----------------------------------------------------------------------

alter table graph_companies      enable row level security;
alter table graph_persons        enable row level security;
alter table graph_sources        enable row level security;
alter table graph_edges          enable row level security;

create policy gc_member_all on graph_companies
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy gp_member_all on graph_persons
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy gs_member_all on graph_sources
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy ge_member_all on graph_edges
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- Primitives -----------------------------------------------------------------

alter table signals              enable row level security;
alter table conversations        enable row level security;
alter table messages             enable row level security;
alter table reps                 enable row level security;
alter table rep_memory_episodic  enable row level security;
alter table rep_memory_semantic  enable row level security;
alter table rep_memory_procedural enable row level security;
alter table plays                enable row level security;
alter table play_runs            enable row level security;
alter table outcomes             enable row level security;

create policy sig_member_all on signals
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy conv_member_all on conversations
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy msg_member_all on messages
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy reps_member_all on reps
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy rme_member_all on rep_memory_episodic
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy rms_member_all on rep_memory_semantic
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy rmp_member_all on rep_memory_procedural
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy plays_member_all on plays
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy plays_admin_delete on plays
  for delete using (is_workspace_admin(workspace_id));

create policy pruns_member_all on play_runs
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy outcomes_member_all on outcomes
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- Channels -------------------------------------------------------------------

alter table channel_accounts     enable row level security;
alter table sending_domains      enable row level security;

create policy ca_member_select on channel_accounts
  for select using (is_workspace_member(workspace_id));

create policy ca_admin_write on channel_accounts
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

create policy sd_member_select on sending_domains
  for select using (is_workspace_member(workspace_id));

create policy sd_admin_write on sending_domains
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
