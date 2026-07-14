-- 048_maintenance_fanout_cursors.sql
-- Capped control-plane fanout must rotate fairly instead of repeatedly serving
-- the same lowest workspace ids.

create table maintenance_fanout_cursors (
  category          text primary key,
  last_workspace_id uuid references workspaces(id) on delete set null,
  updated_at        timestamptz not null default now()
);

comment on table maintenance_fanout_cursors is
  'Durable round-robin cursors preventing capped maintenance fanout from starving tenants.';
