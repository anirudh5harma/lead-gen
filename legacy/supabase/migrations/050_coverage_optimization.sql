-- ============================================================
-- 050_coverage_optimization.sql
-- Phase 5 coverage optimization loop: durable source decisions
-- and feed/query recommendations.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_coverage_recommendations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  recommendation_key  TEXT NOT NULL,
  recommendation_type TEXT NOT NULL CHECK (recommendation_type IN (
    'increase_source_priority',
    'decrease_source_priority',
    'add_feed',
    'add_query',
    'expand_signal_type',
    'review_noisy_source'
  )),
  source_name         TEXT,
  source_type         TEXT,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL,
  suggested_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence            JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_impact     INT NOT NULL DEFAULT 50 CHECK (expected_impact >= 0 AND expected_impact <= 100),
  estimated_cost_usd  NUMERIC(12,6) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'applied', 'dismissed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_coverage_recommendations_user_client_key_idx
  ON gtm_coverage_recommendations(user_id, client_id, recommendation_key)
  WHERE user_id IS NOT NULL AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_coverage_recommendations_user_null_client_key_idx
  ON gtm_coverage_recommendations(user_id, recommendation_key)
  WHERE user_id IS NOT NULL AND client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_coverage_recommendations_global_key_idx
  ON gtm_coverage_recommendations(recommendation_key)
  WHERE user_id IS NULL AND client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_coverage_recommendations_status_idx
  ON gtm_coverage_recommendations(user_id, client_id, status, expected_impact DESC, created_at DESC);

ALTER TABLE gtm_coverage_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own coverage recommendations" ON gtm_coverage_recommendations;
CREATE POLICY "Users can manage own coverage recommendations"
  ON gtm_coverage_recommendations FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage coverage recommendations" ON gtm_coverage_recommendations;
CREATE POLICY "Service role can manage coverage recommendations"
  ON gtm_coverage_recommendations FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_coverage_recommendations_updated_at ON gtm_coverage_recommendations;
CREATE TRIGGER gtm_coverage_recommendations_updated_at
  BEFORE UPDATE ON gtm_coverage_recommendations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
