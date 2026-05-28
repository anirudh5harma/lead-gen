-- 010_primitive_outcome.sql
-- Outcome primitive: a scored, attributable result. The ONLY thing that gates
-- learning (procedural memory updates) and billing.

create type outcome_kind as enum (
  'positive_reply',
  'meeting_booked',
  'opportunity_created',
  'deal_won',
  'deal_lost',
  'post_published',
  'follower_lift',
  'engagement_lift',
  'unsubscribe',
  'bounce',
  'do_not_contact'
);

create table outcomes (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references workspaces(id) on delete cascade,

  kind                     outcome_kind not null,

  -- Outcome value on a normalized 0..1 scale (or signed for negative outcomes).
  -- Concrete economic value (revenue, etc.) goes in properties.
  score                    numeric(6,4) not null,

  -- Attribution links. All optional — the attribution engine fills in what it
  -- can determine. Conversations have a single counterparty so they're a
  -- reliable anchor.
  conversation_id          uuid references conversations(id) on delete set null,
  attributed_message_id    uuid references messages(id) on delete set null,
  attributed_signal_id     uuid references signals(id) on delete set null,
  attributed_play_id       uuid references plays(id) on delete set null,
  attributed_play_run_id   uuid references play_runs(id) on delete set null,
  attributed_rep_id        uuid references reps(id) on delete set null,

  -- Optional graph anchors (for outcomes not tied to a conversation, e.g.
  -- a post hitting a follower-lift threshold).
  subject_person_id        uuid references graph_persons(id) on delete set null,
  subject_company_id       uuid references graph_companies(id) on delete set null,

  properties               jsonb not null default '{}'::jsonb,
  provenance               jsonb not null default '{}'::jsonb,

  occurred_at              timestamptz not null default now(),
  recorded_at              timestamptz not null default now()
);

create index outcomes_workspace_kind_time_idx
  on outcomes (workspace_id, kind, occurred_at desc);

create index outcomes_workspace_conversation_idx
  on outcomes (workspace_id, conversation_id)
  where conversation_id is not null;

create index outcomes_workspace_play_idx
  on outcomes (workspace_id, attributed_play_id)
  where attributed_play_id is not null;

create index outcomes_workspace_rep_idx
  on outcomes (workspace_id, attributed_rep_id)
  where attributed_rep_id is not null;
