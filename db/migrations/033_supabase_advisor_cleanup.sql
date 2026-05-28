-- 033_supabase_advisor_cleanup.sql
-- Resolve the remaining SQL-owned advisor findings after 032. The app should
-- never access schema_migrations through PostgREST, so the policy is an
-- explicit deny while migration owners/service roles continue to bypass RLS.

drop policy if exists schema_migrations_no_client_access on public.schema_migrations;
create policy schema_migrations_no_client_access on public.schema_migrations
  for all using (false)
  with check (false);

-- The Play primitive is member-readable/editable, but deletion is an admin
-- operation. Split the broad member policy so it no longer overlaps the
-- admin delete policy.

drop policy if exists plays_member_all on public.plays;
drop policy if exists plays_member_select on public.plays;
drop policy if exists plays_member_insert on public.plays;
drop policy if exists plays_member_update on public.plays;

create policy plays_member_select on public.plays
  for select using (is_workspace_member(workspace_id));
create policy plays_member_insert on public.plays
  for insert with check (is_workspace_member(workspace_id));
create policy plays_member_update on public.plays
  for update using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
