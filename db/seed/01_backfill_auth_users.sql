-- db/seed/01_backfill_auth_users.sql
-- ───────────────────────────────────────────────────────────────────────────
-- Seats your existing Supabase Auth users into the pivot-v2 tenant model.
-- Run AFTER `npm run migrate` has installed the pivot-v2 schema into public.
--
-- It is idempotent — safe to re-run. It will:
--   1. Create a single "Default Workspace" (no-op if it already exists).
--   2. Grant every email-confirmed auth.users identity membership in it.
--      The address in OWNER_EMAIL below becomes the workspace owner;
--      everyone else is a member.
--
-- EDIT THIS ONE LINE before running — set it to your own login email:
--   (used once, in the CASE expression below)
-- ───────────────────────────────────────────────────────────────────────────

insert into workspaces (slug, name)
values ('default', 'Default Workspace')
on conflict (slug) do nothing;

insert into workspace_members (workspace_id, user_id, role, accepted_at)
select w.id,
       u.id,
       case
         when lower(u.email) = lower('you@example.com') then 'owner'::workspace_role
         else 'member'::workspace_role
       end,
       now()
from workspaces w
cross join auth.users u
where w.slug = 'default'
  and u.email_confirmed_at is not null
on conflict (workspace_id, user_id) do nothing;

-- Sanity check (optional): how many members landed?
--   select role, count(*) from workspace_members group by role;
