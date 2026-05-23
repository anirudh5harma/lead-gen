-- ============================================================
-- 072_signals_runtime_contract_repair.sql
-- Reassert every signals column used by runtime cron routes.
-- This fixes databases that missed earlier incremental repairs and
-- reloads PostgREST so schema-cache errors stop after migration.
-- ============================================================

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS source_name TEXT DEFAULT 'google_news',
  ADD COLUMN IF NOT EXISTS novelty_key TEXT,
  ADD COLUMN IF NOT EXISTS event_cluster_key TEXT,
  ADD COLUMN IF NOT EXISTS corroborating_source_count INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cluster_score INT NOT NULL DEFAULT 0 CHECK (cluster_score >= 0 AND cluster_score <= 100),
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS webhook_broadcast_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

UPDATE signals
SET created_at = COALESCE(processed_at, published_at, now())
WHERE created_at IS NULL;

ALTER TABLE signals
  ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS signals_novelty_published_idx
  ON signals(novelty_key, published_at DESC)
  WHERE novelty_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_event_cluster_idx
  ON signals(event_cluster_key, published_at DESC)
  WHERE event_cluster_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_cluster_score_idx
  ON signals(cluster_score DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS signals_webhook_broadcast_idx
  ON signals(webhook_broadcast_at)
  WHERE webhook_broadcast_at IS NULL;

CREATE INDEX IF NOT EXISTS signals_created_at_idx
  ON signals(created_at DESC);

NOTIFY pgrst, 'reload schema';
