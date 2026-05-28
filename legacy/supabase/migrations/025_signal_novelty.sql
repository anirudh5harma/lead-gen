-- ============================================================
-- 025_signal_novelty.sql
-- Event-level novelty clustering for signals and lead dedupe
-- ============================================================

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS novelty_key TEXT;

CREATE INDEX IF NOT EXISTS signals_novelty_published_idx
  ON signals(novelty_key, published_at DESC)
  WHERE novelty_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_company_domain_published_idx
  ON signals(company_domain, published_at DESC)
  WHERE company_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS signals_company_name_published_idx
  ON signals(company_name, published_at DESC);
