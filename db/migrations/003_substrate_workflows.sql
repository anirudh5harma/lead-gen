-- 003_substrate_workflows.sql
-- Durable workflow runtime. Every long-running operation (a Play execution,
-- an enrichment fan-out, a send pipeline) is a row in workflow_runs with
-- journaled steps and checkpoints. The runtime adapter (dev in-process or
-- Restate in production) replays from these tables on crash/deploy.

create type workflow_run_status as enum (
  'pending',         -- scheduled, not yet started
  'running',
  'awaiting_approval',
  'awaiting_event',  -- parked, waiting for an external event to wake it
  'completed',
  'failed',
  'cancelled'
);

create type workflow_step_status as enum (
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'compensated'      -- saga semantics: rolled back after a downstream failure
);

create type approval_decision as enum ('pending', 'approved', 'rejected', 'expired');

-- Workflow runs --------------------------------------------------------------

create table workflow_runs (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references workspaces(id) on delete cascade,

  workflow_name        text not null,         -- e.g. 'play:founder_cold_email@v3'
  workflow_version     text not null,

  -- Optional linkage to the user-facing Play that compiled to this workflow.
  play_id              uuid,                  -- FK added in 009_primitive_play.sql
  play_run_id          uuid,                  -- FK added in 009_primitive_play.sql

  status               workflow_run_status not null default 'pending',
  input                jsonb not null default '{}'::jsonb,
  output               jsonb,
  error                jsonb,

  -- Idempotency: callers pass an idempotency_key; duplicates collapse to the
  -- same run.
  idempotency_key      text,

  started_at           timestamptz,
  ended_at             timestamptz,
  last_checkpoint_at   timestamptz,
  created_at           timestamptz not null default now()
);

create unique index workflow_runs_idempotency_idx
  on workflow_runs (workspace_id, workflow_name, idempotency_key)
  where idempotency_key is not null;

create index workflow_runs_workspace_status_idx
  on workflow_runs (workspace_id, status, created_at desc);

-- Workflow steps -------------------------------------------------------------

create table workflow_steps (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references workflow_runs(id) on delete cascade,
  workspace_id         uuid not null references workspaces(id) on delete cascade,

  step_name            text not null,
  step_position        integer not null,      -- monotonically increasing within a run
  attempt              integer not null default 1,

  status               workflow_step_status not null default 'pending',
  input                jsonb,
  output               jsonb,
  error                jsonb,

  started_at           timestamptz,
  ended_at             timestamptz,
  created_at           timestamptz not null default now()
);

create unique index workflow_steps_run_position_attempt_idx
  on workflow_steps (run_id, step_position, attempt);

create index workflow_steps_workspace_status_idx
  on workflow_steps (workspace_id, status);

-- Workflow checkpoints -------------------------------------------------------
-- Journaled state for replay. Each checkpoint is a content-addressable snapshot
-- of the workflow's durable promise resolution at a given position.

create table workflow_checkpoints (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references workflow_runs(id) on delete cascade,
  workspace_id         uuid not null references workspaces(id) on delete cascade,

  position             integer not null,
  data                 jsonb not null,
  created_at           timestamptz not null default now()
);

create unique index workflow_checkpoints_run_position_idx
  on workflow_checkpoints (run_id, position);

-- Approval gates -------------------------------------------------------------
-- First-class human-in-loop. Plays parameterize autonomy as per-channel,
-- per-volume gates; gates that need human input land here.

create table workflow_approvals (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references workflow_runs(id) on delete cascade,
  step_id              uuid references workflow_steps(id) on delete cascade,
  workspace_id         uuid not null references workspaces(id) on delete cascade,

  kind                 text not null,         -- e.g. 'outbound.email.send', 'voice.call.dispatch'
  reason               text,
  payload              jsonb not null default '{}'::jsonb,

  decision             approval_decision not null default 'pending',
  decided_by           uuid,                  -- user_id
  decided_at           timestamptz,
  decision_note        text,

  expires_at           timestamptz,
  created_at           timestamptz not null default now()
);

create index workflow_approvals_pending_idx
  on workflow_approvals (workspace_id, created_at desc)
  where decision = 'pending';
