-- ============================================================
-- 069_signal_candidate_audit_columns_repair.sql
-- Reassert candidate filter audit columns for databases that
-- missed migration 044 or have drifted from the application code.
-- ============================================================

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
