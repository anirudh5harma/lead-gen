-- ============================================================
-- 044_signal_source_ledger_and_filter.sql
-- Source economics, candidate-level filter audit, and cluster
-- corroboration metadata for signal coverage moat work.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_source_runs (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_run_id                UUID REFERENCES cron_runs(id) ON DELETE SET NULL,
  source_name                TEXT NOT NULL,
  source_type                TEXT NOT NULL DEFAULT 'unknown',
  fetched_count              INT NOT NULL DEFAULT 0,
  raw_candidate_count        INT NOT NULL DEFAULT 0,
  filter_passed_count        INT NOT NULL DEFAULT 0,
  filter_rejected_count      INT NOT NULL DEFAULT 0,
  extraction_success_count   INT NOT NULL DEFAULT 0,
  extraction_null_count      INT NOT NULL DEFAULT 0,
  extraction_error_count     INT NOT NULL DEFAULT 0,
  duplicate_count            INT NOT NULL DEFAULT 0,
  inserted_signal_count      INT NOT NULL DEFAULT 0,
  matched_lead_count         INT NOT NULL DEFAULT 0,
  sent_count                 INT NOT NULL DEFAULT 0,
  replied_count              INT NOT NULL DEFAULT 0,
  booked_count               INT NOT NULL DEFAULT 0,
  estimated_cost_usd         NUMERIC(12,6) NOT NULL DEFAULT 0,
  attributes                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_source_runs_source_time_idx
  ON gtm_source_runs(source_name, started_at DESC);

CREATE INDEX IF NOT EXISTS gtm_source_runs_inserted_idx
  ON gtm_source_runs(inserted_signal_count DESC, started_at DESC);

ALTER TABLE gtm_source_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage gtm source runs" ON gtm_source_runs;
CREATE POLICY "Service role can manage gtm source runs"
  ON gtm_source_runs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE signal_candidates
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS raw_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS entity_hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS junk_filter_output JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS filter_decision TEXT,
  ADD COLUMN IF NOT EXISTS filter_score INT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS signal_candidates_source_filter_idx
  ON signal_candidates(source_name, filter_decision, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS signal_candidates_raw_payload_hash_idx
  ON signal_candidates(raw_payload_hash)
  WHERE raw_payload_hash IS NOT NULL;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS event_cluster_key TEXT,
  ADD COLUMN IF NOT EXISTS corroborating_source_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cluster_score INT NOT NULL DEFAULT 0 CHECK (cluster_score >= 0 AND cluster_score <= 100),
  ADD COLUMN IF NOT EXISTS source_type TEXT;

CREATE INDEX IF NOT EXISTS signals_event_cluster_idx
  ON signals(event_cluster_key, published_at DESC)
  WHERE event_cluster_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_cluster_score_idx
  ON signals(cluster_score DESC, published_at DESC);
