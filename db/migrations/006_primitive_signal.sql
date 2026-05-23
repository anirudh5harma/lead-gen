-- 006_primitive_signal.sql
-- Signal primitive (ARCHITECTURE.md: one of the five user-facing nouns).
-- A Signal is a typed event that may justify action. It carries:
--   * type + content drawn from a Source
--   * novelty (cluster-aware dedup score)
--   * freshness (when the underlying event happened, not when we ingested)
--   * audience hint (who in our ICP this is most likely about)
--   * optional linkage to graph nodes (person, company)
--   * an embedding for hybrid retrieval

create type signal_kind as enum (
  'funding',
  'hiring',
  'leadership_change',
  'product_launch',
  'acquisition',
  'churn_risk',
  'competitor_move',
  'podcast_mention',
  'press_mention',
  'regulation',
  'expansion',
  'layoff',
  'other'
);

create type signal_status as enum (
  'ingested',      -- raw, not yet matched to ICP
  'matched',       -- passed ICP matcher
  'in_play',       -- a Play has picked it up
  'spent',         -- acted upon; outcome recorded or dismissed
  'dismissed'      -- explicitly rejected
);

create table signals (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  source_id         uuid references graph_sources(id) on delete set null,

  kind              signal_kind not null,
  title             text not null,
  content           text,
  url               text,

  -- Cluster key produced by the novelty detector. Signals with the same
  -- novelty_key within a workspace are considered the same underlying event.
  novelty_key       text,
  novelty_score     numeric(5,4),             -- 0..1, higher = more novel

  -- When the underlying event happened (TechCrunch publish date, etc.), not
  -- when we ingested it. Used for freshness gating in Plays.
  freshness_at      timestamptz not null,

  -- ICP match metadata produced by the matcher agent.
  audience_hint     jsonb not null default '{}'::jsonb,
  match_score       numeric(5,4),
  match_reason      text,

  -- Optional graph linkage (best-effort during ingestion; can be filled in
  -- by enrichment later).
  related_company_id uuid references graph_companies(id) on delete set null,
  related_person_id  uuid references graph_persons(id)   on delete set null,

  status            signal_status not null default 'ingested',

  properties        jsonb not null default '{}'::jsonb,
  provenance        jsonb not null default '{}'::jsonb,

  embedding         vector(1536),
  embedded_at       timestamptz,

  ingested_at       timestamptz not null default now()
);

create index signals_workspace_status_freshness_idx
  on signals (workspace_id, status, freshness_at desc);

create index signals_workspace_kind_idx
  on signals (workspace_id, kind, freshness_at desc);

create index signals_novelty_idx
  on signals (workspace_id, novelty_key)
  where novelty_key is not null;

create index signals_related_company_idx
  on signals (workspace_id, related_company_id)
  where related_company_id is not null;

create index signals_embedding_idx
  on signals using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index signals_properties_gin_idx
  on signals using gin (properties);
