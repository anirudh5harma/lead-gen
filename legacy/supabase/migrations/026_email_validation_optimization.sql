-- ============================================================
-- 026_email_validation_optimization.sql
-- Validation cache + company-level enrichment cache
-- ============================================================

ALTER TABLE company_contact_candidates
  ADD COLUMN IF NOT EXISTS company_key TEXT,
  ADD COLUMN IF NOT EXISTS resolution_method TEXT
    CHECK (resolution_method IN ('direct', 'pattern', 'role'));

CREATE INDEX IF NOT EXISTS company_contact_candidates_company_key_idx
  ON company_contact_candidates(company_key, base_score DESC, enriched_at DESC)
  WHERE company_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_validation_cache (
  email         TEXT PRIMARY KEY,
  status        TEXT NOT NULL,
  sub_status    TEXT,
  free_email    BOOLEAN,
  mx_found      BOOLEAN,
  did_you_mean  TEXT,
  verified_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_validation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_validation_cache_all"
  ON email_validation_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER email_validation_cache_updated_at
  BEFORE UPDATE ON email_validation_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS email_validation_cache_verified_idx
  ON email_validation_cache(verified_at DESC);

CREATE TABLE IF NOT EXISTS company_enrichment_cache (
  company_key          TEXT PRIMARY KEY,
  company_name         TEXT NOT NULL,
  input_domain         TEXT,
  resolved_domain      TEXT,
  last_attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_succeeded_at    TIMESTAMPTZ,
  last_failed_at       TIMESTAMPTZ,
  last_contact_count   INT NOT NULL DEFAULT 0,
  zb_validations_used  INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE company_enrichment_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_company_enrichment_cache_all"
  ON company_enrichment_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER company_enrichment_cache_updated_at
  BEFORE UPDATE ON company_enrichment_cache
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS company_enrichment_cache_attempted_idx
  ON company_enrichment_cache(last_attempted_at DESC, last_failed_at DESC);
