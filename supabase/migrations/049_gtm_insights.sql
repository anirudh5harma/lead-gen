-- ============================================================
-- 049_gtm_insights.sql
-- Phase 4 insights engine: durable recommendations with
-- evidence, confidence, impact scoring, and actionable CTAs.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_insights (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                   UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  insight_key                 TEXT NOT NULL,
  insight_type                TEXT NOT NULL CHECK (insight_type IN (
    'source_gap',
    'source_waste',
    'source_winner',
    'persona_winner',
    'reply_pattern',
    'content_opportunity',
    'coverage_gap',
    'stale_contact_risk',
    'automation_safety',
    'pipeline_movement'
  )),
  title                       TEXT NOT NULL,
  summary                     TEXT NOT NULL,
  evidence                    JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence                  NUMERIC(5,4) NOT NULL DEFAULT 0.75 CHECK (confidence >= 0 AND confidence <= 1),
  impact_score                INT NOT NULL DEFAULT 50 CHECK (impact_score >= 0 AND impact_score <= 100),
  recommended_action_type     TEXT NOT NULL,
  recommended_action_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                      TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'actioned', 'dismissed', 'archived')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_insights_user_client_key_idx
  ON gtm_insights(user_id, client_id, insight_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_insights_user_null_client_key_idx
  ON gtm_insights(user_id, insight_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_insights_user_status_impact_idx
  ON gtm_insights(user_id, client_id, status, impact_score DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS gtm_insights_type_idx
  ON gtm_insights(insight_type, created_at DESC);

ALTER TABLE gtm_insights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gtm insights" ON gtm_insights;
CREATE POLICY "Users can manage own gtm insights"
  ON gtm_insights FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm insights" ON gtm_insights;
CREATE POLICY "Service role can manage gtm insights"
  ON gtm_insights FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_insights_updated_at ON gtm_insights;
CREATE TRIGGER gtm_insights_updated_at
  BEFORE UPDATE ON gtm_insights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
