-- 016_signal_candidates.sql
-- The shared candidates pool that powers the catalog-poll architecture.
--
-- Refinement A from docs/signal-ingestion.md: when a source is keyed by
-- company (Greenhouse, Lever, Ashby, Workable, SEC EDGAR per CIK), polling
-- ONCE platform-wide and fanning the result out to interested workspaces
-- is dramatically cheaper than per-workspace polling. This table is the
-- shared pool the fanout step reads from.
--
-- Rows here are workspace-AGNOSTIC. Workspace-scoped `signals` rows are
-- created by the fanout step (audited in `signal_candidate_fanouts`).

create table signal_candidates (
  id                  uuid primary key default gen_random_uuid(),
  source_id           uuid not null references graph_sources(id) on delete cascade,

  -- Upstream item identity (Greenhouse job id, SEC accession number, RSS
  -- guid, etc.). Combined with source_id, globally unique — guarantees the
  -- catalog poll never inserts the same upstream item twice.
  external_id         text not null,
  external_thread_id  text,

  -- Adapter-declared signal kind. NULL means stage 2 must classify.
  -- ATS adapters declare 'hiring', SEC adapters declare based on form/item
  -- code, news/RSS adapters leave NULL.
  kind                signal_kind,

  -- The catalog company this item is about, when known. Set by adapters
  -- that are keyed by company.
  company_id          uuid references tracked_companies(id) on delete set null,

  title               text not null,
  content             text,
  url                 text,

  -- Adapter-declared structured fields. For hiring: role, function,
  -- seniority, location, remote_ok, posted_at. For funding: amount,
  -- stage, lead_investor. Lets the ICP must-haves pre-filter run cheaply.
  structured          jsonb not null default '{}'::jsonb,

  -- Raw upstream payload subset for forensics.
  provenance          jsonb not null default '{}'::jsonb,

  -- Computed at ingest time (DeepSeek embedding of title + first 200 chars).
  -- Powers fuzzy dedup; cheap to compute (~$0.00001 per item).
  embedding           vector(1536),

  -- Exact-key dedup hash. Adapter-computed.
  novelty_key         text,
  -- Bumped each time a duplicate is collapsed into this row. A high count
  -- is itself a "this is being widely covered" signal.
  novelty_count       integer not null default 1,

  -- When the upstream event happened (publish date, posted date), NOT when
  -- we ingested. Used by Plays + freshness-aware downstreams.
  freshness_at        timestamptz not null,
  ingested_at         timestamptz not null default now(),

  -- 'active'  — currently visible upstream
  -- 'expired' — the upstream no longer surfaces this id (job filled,
  --             page deleted). Triggers signal.expired downstream so
  --             stale hiring posts don't drive fresh outreach.
  status              text not null default 'active'
                        check (status in ('active', 'expired')),
  expired_at          timestamptz
);

-- Global uniqueness per (source, external item).
create unique index signal_candidates_source_extid_idx
  on signal_candidates (source_id, external_id);

-- Fanout lookup: "which active candidates exist for this company?"
create index signal_candidates_company_status_freshness_idx
  on signal_candidates (company_id, status, freshness_at desc)
  where company_id is not null;

-- Exact-key dedup probes by novelty_key.
create index signal_candidates_novelty_idx
  on signal_candidates (novelty_key) where novelty_key is not null;

-- Lifecycle queries: "what's active right now?", "expire stale stuff".
create index signal_candidates_status_freshness_idx
  on signal_candidates (status, freshness_at desc);

-- Fuzzy dedup nearest-neighbour search.
create index signal_candidates_embedding_idx
  on signal_candidates using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ───────────────────────────────────────────────────────────────────────────
-- Fanout audit. The fanout step writes one row per (candidate, workspace)
-- that received a workspace-scoped `signals` projection. Prevents
-- double-fanout if a candidate is re-evaluated (e.g., when a new ICP is
-- added and we backfill against the existing pool).
-- ───────────────────────────────────────────────────────────────────────────

create table signal_candidate_fanouts (
  candidate_id  uuid not null references signal_candidates(id) on delete cascade,
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  signal_id     uuid references signals(id) on delete set null,
  fanned_at     timestamptz not null default now(),
  /** 'created' = a fresh signal row;  'skipped:must_haves' = workspace's
      ICP pre-filter dropped it before insert; 'skipped:budget' = the
      workspace's candidate cap was already used up. */
  outcome       text not null default 'created'
                  check (outcome in ('created', 'skipped:must_haves', 'skipped:budget', 'skipped:dedup')),
  primary key (candidate_id, workspace_id)
);

create index signal_candidate_fanouts_workspace_time_idx
  on signal_candidate_fanouts (workspace_id, fanned_at desc);

-- ───────────────────────────────────────────────────────────────────────────
-- Link workspace-scoped signals back to the shared candidate they came
-- from. Makes propagation of signal.expired straightforward: when a
-- candidate flips to 'expired', we know which signals to also mark spent.
-- ───────────────────────────────────────────────────────────────────────────

alter table signals
  add column origin_candidate_id uuid references signal_candidates(id) on delete set null;

create index signals_origin_candidate_idx
  on signals (origin_candidate_id)
  where origin_candidate_id is not null;

-- ───────────────────────────────────────────────────────────────────────────
-- RLS.
-- signal_candidates + signal_candidate_fanouts are PLATFORM-LEVEL state
-- (workspace-agnostic). They're readable by any workspace member so the
-- fanout step (which runs as the service role) and ad-hoc forensics work
-- without elaborate plumbing; writes are admin-only as a defence in depth.
-- Production should restrict further to a platform service role.
-- ───────────────────────────────────────────────────────────────────────────

alter table signal_candidates         enable row level security;
alter table signal_candidate_fanouts  enable row level security;

create policy candidates_member_select on signal_candidates
  for select using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id() and wm.accepted_at is not null
    )
  );
create policy candidates_admin_write on signal_candidates
  for all using (
    exists (
      select 1 from workspace_members wm
      where wm.user_id = current_user_id()
        and wm.role in ('owner', 'admin')
        and wm.accepted_at is not null
    )
  ) with check (true);

create policy fanouts_member_select on signal_candidate_fanouts
  for select using (is_workspace_member(workspace_id));
create policy fanouts_admin_write on signal_candidate_fanouts
  for all using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
