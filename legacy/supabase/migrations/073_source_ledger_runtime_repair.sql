-- ============================================================
-- 073_source_ledger_runtime_repair.sql
-- Reassert source-ledger runtime tables for databases that missed
-- migrations 044/046 or whose PostgREST schema cache did not reload.
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

CREATE TABLE IF NOT EXISTS gtm_sources (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  source_key               TEXT NOT NULL,
  source_type              TEXT NOT NULL DEFAULT 'unknown',
  label                    TEXT NOT NULL,
  url                      TEXT,
  category                 TEXT,
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  poll_frequency_minutes   INT NOT NULL DEFAULT 720 CHECK (poll_frequency_minutes > 0),
  priority                 INT NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  cost_model               JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes               JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_sources_user_client_key_idx
  ON gtm_sources(user_id, client_id, source_key)
  WHERE user_id IS NOT NULL AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_sources_user_null_client_key_idx
  ON gtm_sources(user_id, source_key)
  WHERE user_id IS NOT NULL AND client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_sources_global_key_idx
  ON gtm_sources(source_key)
  WHERE user_id IS NULL AND client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_sources_enabled_priority_idx
  ON gtm_sources(enabled, priority DESC, last_seen_at DESC);

ALTER TABLE gtm_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm sources" ON gtm_sources;
CREATE POLICY "Users can view own gtm sources"
  ON gtm_sources FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm sources" ON gtm_sources;
CREATE POLICY "Service role can manage gtm sources"
  ON gtm_sources FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_sources_updated_at ON gtm_sources;
CREATE TRIGGER gtm_sources_updated_at
  BEFORE UPDATE ON gtm_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
