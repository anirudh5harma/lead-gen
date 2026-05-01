-- ============================================================
-- 043_gtm_launch_readiness_and_learning.sql
-- Durable primitives for launch readiness, signal clustering,
-- first-class outreach plans, and source outcome learning.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_signal_clusters (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                  UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_id                 UUID REFERENCES gtm_accounts(id) ON DELETE CASCADE,
  cluster_key                TEXT NOT NULL,
  signal_type                TEXT NOT NULL,
  representative_signal_id   UUID REFERENCES gtm_signals(id) ON DELETE SET NULL,
  signal_count               INT NOT NULL DEFAULT 1,
  quality_score              INT NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  novelty_score              INT NOT NULL DEFAULT 0 CHECK (novelty_score >= 0 AND novelty_score <= 100),
  fit_score                  INT NOT NULL DEFAULT 0 CHECK (fit_score >= 0 AND fit_score <= 100),
  urgency_score              INT NOT NULL DEFAULT 0 CHECK (urgency_score >= 0 AND urgency_score <= 100),
  outreachability_score      INT NOT NULL DEFAULT 0 CHECK (outreachability_score >= 0 AND outreachability_score <= 100),
  source_reliability_score   INT NOT NULL DEFAULT 0 CHECK (source_reliability_score >= 0 AND source_reliability_score <= 100),
  weighted_score             INT NOT NULL DEFAULT 0 CHECK (weighted_score >= 0 AND weighted_score <= 100),
  attributes                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_observed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_signal_clusters_user_client_key_idx
  ON gtm_signal_clusters(user_id, client_id, cluster_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_signal_clusters_user_null_client_key_idx
  ON gtm_signal_clusters(user_id, cluster_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_signal_clusters_account_score_idx
  ON gtm_signal_clusters(account_id, weighted_score DESC, last_observed_at DESC)
  WHERE account_id IS NOT NULL;

ALTER TABLE gtm_signal_clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm signal clusters" ON gtm_signal_clusters;
CREATE POLICY "Users can view own gtm signal clusters"
  ON gtm_signal_clusters FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm signal clusters" ON gtm_signal_clusters;
CREATE POLICY "Service role can manage gtm signal clusters"
  ON gtm_signal_clusters FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_signal_clusters_updated_at
  BEFORE UPDATE ON gtm_signal_clusters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_outreach_plans (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                  UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  lead_id                    UUID REFERENCES leads(id) ON DELETE CASCADE,
  account_id                 UUID REFERENCES gtm_accounts(id) ON DELETE SET NULL,
  person_id                  UUID REFERENCES gtm_people(id) ON DELETE SET NULL,
  plan_version               TEXT NOT NULL DEFAULT 'outreach_plan_v1',
  status                     TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'needs_review', 'approved', 'blocked', 'sent', 'dismissed')),
  confidence                 INT NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  trigger                    TEXT NOT NULL,
  persona                    TEXT NOT NULL,
  angle                      TEXT NOT NULL,
  proof                      TEXT NOT NULL,
  safety_checks              JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_flags                 TEXT[] NOT NULL DEFAULT '{}',
  plan                       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_workflow_run_id UUID REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL,
  created_by_agent_run_id    UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_outreach_plans_lead_idx
  ON gtm_outreach_plans(lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_outreach_plans_user_status_idx
  ON gtm_outreach_plans(user_id, client_id, status, created_at DESC);

ALTER TABLE gtm_outreach_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm outreach plans" ON gtm_outreach_plans;
CREATE POLICY "Users can view own gtm outreach plans"
  ON gtm_outreach_plans FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm outreach plans" ON gtm_outreach_plans;
CREATE POLICY "Service role can manage gtm outreach plans"
  ON gtm_outreach_plans FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_outreach_plans_updated_at
  BEFORE UPDATE ON gtm_outreach_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_source_reliability (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id             UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  source_key            TEXT NOT NULL,
  source_name           TEXT NOT NULL,
  signal_type           TEXT,
  signal_count          INT NOT NULL DEFAULT 0,
  sent_count            INT NOT NULL DEFAULT 0,
  replied_count         INT NOT NULL DEFAULT 0,
  booked_count          INT NOT NULL DEFAULT 0,
  dismissed_count       INT NOT NULL DEFAULT 0,
  bounced_count         INT NOT NULL DEFAULT 0,
  unsubscribed_count    INT NOT NULL DEFAULT 0,
  reliability_score     INT NOT NULL DEFAULT 60 CHECK (reliability_score >= 0 AND reliability_score <= 100),
  last_outcome          TEXT,
  last_observed_at      TIMESTAMPTZ,
  attributes            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_source_reliability_user_client_key_idx
  ON gtm_source_reliability(user_id, client_id, source_key, COALESCE(signal_type, ''))
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_source_reliability_user_null_client_key_idx
  ON gtm_source_reliability(user_id, source_key, COALESCE(signal_type, ''))
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_source_reliability_score_idx
  ON gtm_source_reliability(user_id, client_id, reliability_score DESC, updated_at DESC);

ALTER TABLE gtm_source_reliability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm source reliability" ON gtm_source_reliability;
CREATE POLICY "Users can view own gtm source reliability"
  ON gtm_source_reliability FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm source reliability" ON gtm_source_reliability;
CREATE POLICY "Service role can manage gtm source reliability"
  ON gtm_source_reliability FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_source_reliability_updated_at
  BEFORE UPDATE ON gtm_source_reliability
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
