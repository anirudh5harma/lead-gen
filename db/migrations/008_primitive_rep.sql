-- 008_primitive_rep.sql
-- Rep primitive: the user-facing agent persona. A Rep has voice, role, KPIs,
-- channels it owns, autonomy posture, and three tiers of memory.
--
-- Underneath a Rep is composed of role agents (researcher, writer, sender,
-- replier) — that composition is a runtime concern (core/agents/reps/) and
-- does not need its own table.

create type rep_role as enum (
  'sdr',                 -- outbound prospecting
  'content',             -- LinkedIn / X / blog voice
  'replier',             -- inbound triage and response
  'researcher',          -- pre-outreach research
  'campaign',            -- multi-channel orchestrator
  'custom'
);

create type rep_status as enum ('draft', 'active', 'paused', 'retired');

create table reps (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,

  name              text not null,            -- e.g. 'Maya', 'Devon — LinkedIn voice for our CTO'
  role              rep_role not null,
  status            rep_status not null default 'draft',

  -- The persona contract: voice, story, KPIs, do's and don'ts, sample writing.
  -- This is the canonical source the writer-agent and judge use.
  persona           jsonb not null default '{}'::jsonb,

  -- Voice fingerprint embedding (mean of canonical examples). Used by the
  -- drift detector to flag drafts that depart from the Rep's voice.
  voice_embedding   vector(1536),

  -- Which channels this Rep is allowed to operate on.
  channels          text[] not null default array[]::text[],

  -- Default autonomy posture (per-Play overrides live on plays.autonomy).
  autonomy          jsonb not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index reps_workspace_name_idx
  on reps (workspace_id, lower(name));

create index reps_workspace_status_idx
  on reps (workspace_id, status);

-- Now that reps exists, finish wiring the FK on conversations.rep_id.
alter table conversations
  add constraint conversations_rep_id_fk
  foreign key (rep_id) references reps(id) on delete restrict;

-- ──────────────────────────────────────────────────────────────────────────
-- Three-tier memory (ARCHITECTURE.md: episodic / semantic / procedural).
-- Each tier is per-Rep, workspace-scoped, embedding-indexed.
-- ──────────────────────────────────────────────────────────────────────────

-- Episodic memory ------------------------------------------------------------
-- Every interaction in raw form. The replay tape.

create table rep_memory_episodic (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  rep_id            uuid not null references reps(id) on delete cascade,

  kind              text not null,            -- 'message_sent', 'message_received', 'decision', 'retrieval', ...
  content           text not null,
  refs              jsonb not null default '{}'::jsonb,   -- pointers into the graph

  occurred_at       timestamptz not null default now(),

  embedding         vector(1536)
);

create index rep_memory_episodic_rep_time_idx
  on rep_memory_episodic (workspace_id, rep_id, occurred_at desc);

create index rep_memory_episodic_embedding_idx
  on rep_memory_episodic using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Semantic memory ------------------------------------------------------------
-- Extracted, deduped facts about people / companies / signals. The Rep's
-- "what I know about this account."

create table rep_memory_semantic (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  rep_id            uuid not null references reps(id) on delete cascade,

  subject_type      text not null,            -- 'person' | 'company' | 'signal'
  subject_id        uuid not null,

  facts             jsonb not null default '{}'::jsonb,
  confidence        numeric(5,4),
  last_observed_at  timestamptz not null default now(),

  embedding         vector(1536)
);

create unique index rep_memory_semantic_unique_subject_idx
  on rep_memory_semantic (workspace_id, rep_id, subject_type, subject_id);

create index rep_memory_semantic_embedding_idx
  on rep_memory_semantic using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Procedural memory ----------------------------------------------------------
-- Winning playbooks per (ICP × signal × stage). Grows from positive outcomes.
-- THE MOAT. The judge and writer-agent retrieve from here as few-shot examples.

create table rep_memory_procedural (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  rep_id            uuid not null references reps(id) on delete cascade,

  pattern_key       text not null,            -- e.g. 'icp:fintech-founder|signal:series_a|stage:cold_open'
  exemplar          jsonb not null,           -- {subject, body, outcome_ref, eval_score, ...}

  score             numeric(5,4) not null,    -- outcome-weighted utility
  win_count         integer not null default 0,
  loss_count        integer not null default 0,
  last_used_at      timestamptz,

  embedding         vector(1536),

  created_at        timestamptz not null default now()
);

create index rep_memory_procedural_pattern_idx
  on rep_memory_procedural (workspace_id, rep_id, pattern_key, score desc);

create index rep_memory_procedural_embedding_idx
  on rep_memory_procedural using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
