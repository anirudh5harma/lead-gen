-- 009_primitive_play.sql
-- Play primitive: a reusable, parameterized workflow. Authored in natural
-- language by the user, compiled into a workflow spec (Step DAG) that the
-- durable runtime executes.
--
-- Autonomy is per-Play × channel × volume — NOT a per-agent toggle. See
-- ARCHITECTURE.md "Agent Fabric" section.

create type play_status as enum ('draft', 'active', 'paused', 'archived');

create table plays (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  name              text not null,
  description       text,

  -- The user's natural-language declaration. The compiler converts this
  -- into `compiled` below. We keep the source of truth so re-compilation
  -- against newer compiler versions is possible.
  declaration       text not null,

  -- The compiled workflow spec: trigger, steps, branches, retry policy,
  -- approval gates. Shape defined in core/plays/spec.ts.
  compiled          jsonb not null default '{}'::jsonb,
  compiler_version  text,

  -- Autonomy gates evaluated at run time. Shape:
  --   {
  --     "channels": {
  --       "email":        { "daily_cap": 50, "approval": "none" },
  --       "linkedin_dm":  { "daily_cap": 10, "approval": "approve_first" },
  --       "voice":        { "daily_cap": 5,  "approval": "always" }
  --     },
  --     "global": { "max_concurrent_conversations": 200 }
  --   }
  autonomy          jsonb not null default '{}'::jsonb,

  -- Default Rep that owns conversations spawned by this Play (overridable
  -- per-run via input.rep_id).
  default_rep_id    uuid references reps(id) on delete set null,

  status            play_status not null default 'draft',
  version           integer not null default 1,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index plays_workspace_name_version_idx
  on plays (workspace_id, lower(name), version);

create index plays_workspace_status_idx
  on plays (workspace_id, status);

-- Play runs ------------------------------------------------------------------
-- One Play run per (Play × trigger event). Always backed by exactly one
-- workflow_run; play_runs is the user-facing projection, workflow_runs is the
-- durable execution.

create type play_run_status as enum (
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled'
);

create table play_runs (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  play_id           uuid not null references plays(id) on delete cascade,

  -- 1:1 with the underlying durable workflow.
  workflow_run_id   uuid not null references workflow_runs(id) on delete cascade unique,

  trigger_event_id  uuid references events(id) on delete set null,
  rep_id            uuid references reps(id) on delete set null,

  status            play_run_status not null default 'pending',
  input             jsonb not null default '{}'::jsonb,
  output            jsonb,

  started_at        timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz not null default now()
);

create index play_runs_workspace_play_idx
  on play_runs (workspace_id, play_id, created_at desc);

create index play_runs_workspace_status_idx
  on play_runs (workspace_id, status, created_at desc);

-- Now that plays + play_runs exist, finish wiring workflow_runs back-pointers.
alter table workflow_runs
  add constraint workflow_runs_play_id_fk
  foreign key (play_id) references plays(id) on delete set null;

alter table workflow_runs
  add constraint workflow_runs_play_run_id_fk
  foreign key (play_run_id) references play_runs(id) on delete set null;
