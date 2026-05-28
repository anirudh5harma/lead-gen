-- db/seed/00_reset_public.sql
-- ───────────────────────────────────────────────────────────────────────────
-- DESTRUCTIVE. Wipes the entire `public` schema (all legacy Bombsell tables,
-- types, functions, policies) and recreates it empty with Supabase's standard
-- grants, so the pivot-v2 migrations can install cleanly into a fresh schema.
--
-- WHAT THIS DOES NOT TOUCH: the `auth` schema. Your Supabase Auth users
-- (logins, password hashes, auth.users.id) survive untouched — that is how
-- "start fresh but keep users" works. The legacy tables referenced
-- auth.users only via FK columns; dropping them removes those FKs and leaves
-- auth.users intact.
--
-- BEFORE RUNNING:
--   1. Take a full backup (includes auth as your user safety net):
--        pg_dump "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" \
--          --no-owner --no-privileges -Fc -f bombsell-pre-pivot.dump
--   2. Run this against the DIRECT connection / session pooler (port 5432),
--      NOT the transaction pooler (6543).
--
-- There is no soft rollback once this runs. The backup above is the rollback.
-- ───────────────────────────────────────────────────────────────────────────

drop schema public cascade;
create schema public;

-- Restore Supabase's standard public-schema grants (Studio + PostgREST).
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on all tables    in schema public to postgres, anon, authenticated, service_role;
grant all on all routines  in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on routines  to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;
comment on schema public is 'standard public schema';

-- Next: run `npm run migrate` to install the pivot-v2 schema into public,
-- then run db/seed/01_backfill_auth_users.sql to seat your existing users.
