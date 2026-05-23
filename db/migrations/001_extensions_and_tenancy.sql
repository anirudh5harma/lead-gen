-- 001_extensions_and_tenancy.sql
-- Extensions and the workspace boundary. Workspace is the security boundary
-- for every tenant-scoped row in the system.

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists vector;

-- Workspaces -----------------------------------------------------------------

create table workspaces (
  id                uuid primary key default gen_random_uuid(),
  slug              citext not null unique,
  name              text not null,
  plan              text not null default 'free',
  settings          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz
);

comment on table workspaces is
  'Tenant boundary. Every tenant-scoped table references workspaces(id) and is gated by RLS via is_workspace_member().';

-- Workspace members ----------------------------------------------------------

create type workspace_role as enum ('owner', 'admin', 'member');

create table workspace_members (
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  user_id           uuid not null,
  role              workspace_role not null default 'member',
  invited_at        timestamptz not null default now(),
  accepted_at       timestamptz,
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on workspace_members (user_id);

-- RLS helpers ----------------------------------------------------------------
-- These functions are referenced by every RLS policy in 012_rls_policies.sql.
-- They MUST be `stable` and SECURITY DEFINER-free so they cannot be tricked
-- into elevating privilege.

create or replace function current_user_id()
returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function is_workspace_member(ws uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from workspace_members
    where workspace_id = ws
      and user_id = current_user_id()
      and accepted_at is not null
  )
$$;

create or replace function is_workspace_admin(ws uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from workspace_members
    where workspace_id = ws
      and user_id = current_user_id()
      and role in ('owner', 'admin')
      and accepted_at is not null
  )
$$;
