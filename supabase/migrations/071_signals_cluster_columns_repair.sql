-- ============================================================
-- 071_signals_cluster_columns_repair.sql
-- Reassert signal clustering columns for databases that missed
-- migration 044 or whose PostgREST schema cache did not reload.
-- ============================================================

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

NOTIFY pgrst, 'reload schema';
