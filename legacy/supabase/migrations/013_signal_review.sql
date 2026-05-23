-- ============================================================
-- 013_signal_review.sql
-- Candidate review + lead explainability
-- ============================================================

CREATE TABLE IF NOT EXISTS signal_candidates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint       TEXT NOT NULL UNIQUE,
  title             TEXT NOT NULL,
  description       TEXT,
  source_url        TEXT,
  source_name       TEXT NOT NULL,
  published_at      TIMESTAMPTZ,
  shortlist_score   INT NOT NULL DEFAULT 0,
  shortlist_reason  TEXT,
  extract_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK (extract_status IN ('pending', 'extract_null', 'extract_timeout', 'extract_error', 'duplicate', 'embed_error', 'insert_error', 'inserted')),
  extract_confidence INT,
  extracted_signal  JSONB,
  created_signal_id UUID REFERENCES signals(id) ON DELETE SET NULL,
  processed_at      TIMESTAMPTZ,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE signal_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read signal candidates"
  ON signal_candidates FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role can insert signal candidates"
  ON signal_candidates FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update signal candidates"
  ON signal_candidates FOR UPDATE
  USING (true)
  WITH CHECK (true);

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS match_debug JSONB;

CREATE TRIGGER signal_candidates_updated_at
  BEFORE UPDATE ON signal_candidates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS signal_candidates_created_at_idx ON signal_candidates(created_at DESC);
CREATE INDEX IF NOT EXISTS signal_candidates_status_idx ON signal_candidates(extract_status, processed_at DESC);
