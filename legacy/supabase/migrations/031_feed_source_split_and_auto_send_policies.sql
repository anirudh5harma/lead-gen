-- ============================================================
-- 031_feed_source_split_and_auto_send_policies.sql
-- Separate live/explore/CRM source pipelines and add feed-aware
-- follow-up automation policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS explore_runs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  prompt                   TEXT NOT NULL,
  icp_hint                 TEXT,
  seller_profile_snapshot  TEXT,
  workspace_icp_snapshot   TEXT,
  used_workspace_icp       BOOLEAN NOT NULL DEFAULT false,
  status                   TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  generated_count          INT NOT NULL DEFAULT 0,
  inserted_count           INT NOT NULL DEFAULT 0,
  skipped_count            INT NOT NULL DEFAULT 0,
  error_message            TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS explore_runs_user_client_created_idx
  ON explore_runs(user_id, client_id, created_at DESC);

ALTER TABLE explore_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own explore runs" ON explore_runs;
CREATE POLICY "Users can manage own explore runs"
  ON explore_runs FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS explore_targets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            UUID REFERENCES explore_runs(id) ON DELETE SET NULL,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  result_key        TEXT NOT NULL UNIQUE,
  company_name      TEXT NOT NULL,
  company_domain    TEXT,
  signal_type       TEXT NOT NULL
    CHECK (signal_type IN ('funding', 'acquisition', 'expansion', 'regulation', 'hiring')),
  headline          TEXT NOT NULL,
  summary           TEXT NOT NULL,
  relevance_reason  TEXT NOT NULL,
  relevance_score   INT NOT NULL CHECK (relevance_score BETWEEN 1 AND 10),
  prompt            TEXT NOT NULL,
  icp_hint          TEXT,
  source_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS explore_targets_user_client_created_idx
  ON explore_targets(user_id, client_id, created_at DESC);

ALTER TABLE explore_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own explore targets" ON explore_targets;
CREATE POLICY "Users can manage own explore targets"
  ON explore_targets FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER explore_targets_updated_at
  BEFORE UPDATE ON explore_targets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS crm_import_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,
  import_secret   TEXT,
  record_count    INT NOT NULL DEFAULT 0,
  imported_count  INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_import_batches_user_client_created_idx
  ON crm_import_batches(user_id, client_id, created_at DESC);

ALTER TABLE crm_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own crm import batches" ON crm_import_batches;
CREATE POLICY "Users can manage own crm import batches"
  ON crm_import_batches FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS crm_import_records (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         UUID REFERENCES crm_import_batches(id) ON DELETE SET NULL,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id        UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  record_key       TEXT NOT NULL UNIQUE,
  external_id      TEXT,
  company_name     TEXT NOT NULL,
  company_domain   TEXT,
  contact_email    TEXT,
  contact_name     TEXT,
  contact_title    TEXT,
  crm_status       TEXT,
  owner_name       TEXT,
  lead_source      TEXT,
  notes            TEXT,
  raw_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_import_records_user_client_created_idx
  ON crm_import_records(user_id, client_id, created_at DESC);

ALTER TABLE crm_import_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own crm import records" ON crm_import_records;
CREATE POLICY "Users can manage own crm import records"
  ON crm_import_records FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER crm_import_records_updated_at
  BEFORE UPDATE ON crm_import_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS source_kind TEXT,
  ADD COLUMN IF NOT EXISTS source_record_id UUID,
  ADD COLUMN IF NOT EXISTS feed_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_kind_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_source_kind_check
  CHECK (source_kind IN ('live_signal', 'explore_target', 'crm_record'));

UPDATE leads
SET source_kind = CASE
  WHEN origin = 'explore' THEN 'explore_target'
  WHEN origin = 'crm_import' THEN 'crm_record'
  ELSE 'live_signal'
END
WHERE source_kind IS NULL;

UPDATE leads l
SET feed_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'signal_type', s.signal_type,
  'headline', s.headline,
  'summary', s.summary,
  'funding_amount', s.funding_amount,
  'source_url', s.source_url,
  'source_name', s.source_name,
  'published_at', s.published_at,
  'company_domain', COALESCE(l.company_domain, s.company_domain)
))
FROM signals s
WHERE l.signal_id = s.id
  AND (l.feed_snapshot IS NULL OR l.feed_snapshot = '{}'::jsonb);

UPDATE leads
SET feed_snapshot = jsonb_strip_nulls(jsonb_build_object(
  'signal_type', CASE WHEN origin = 'crm_import' THEN 'crm_import' ELSE 'funding' END,
  'headline', target_company,
  'summary', relevance_reason,
  'company_domain', company_domain,
  'source_name', origin
))
WHERE feed_snapshot IS NULL OR feed_snapshot = '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_client_source_record_unique_idx
  ON leads(user_id, client_id, source_kind, source_record_id)
  WHERE client_id IS NOT NULL AND source_record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS leads_user_source_record_unique_idx
  ON leads(user_id, source_kind, source_record_id)
  WHERE client_id IS NULL AND source_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS auto_send_policies (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id               UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  enabled                 BOOLEAN NOT NULL DEFAULT false,
  connected_account_id    UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  target_origins          TEXT[] NOT NULL DEFAULT ARRAY['live', 'explore', 'crm_import'],
  require_verified_contact BOOLEAN NOT NULL DEFAULT false,
  min_relevance_score     INT NOT NULL DEFAULT 1 CHECK (min_relevance_score BETWEEN 1 AND 10),
  max_lead_age_days       INT NOT NULL DEFAULT 30 CHECK (max_lead_age_days BETWEEN 1 AND 365),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_send_policies_user_client_unique_idx
  ON auto_send_policies(user_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS auto_send_policies_user_null_client_unique_idx
  ON auto_send_policies(user_id)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS auto_send_policies_user_enabled_idx
  ON auto_send_policies(user_id, enabled, updated_at DESC);

ALTER TABLE auto_send_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own auto send policies" ON auto_send_policies;
CREATE POLICY "Users can manage own auto send policies"
  ON auto_send_policies FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER auto_send_policies_updated_at
  BEFORE UPDATE ON auto_send_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO auto_send_policies (
  user_id,
  client_id,
  enabled,
  target_origins,
  require_verified_contact,
  min_relevance_score,
  max_lead_age_days,
  created_at,
  updated_at
)
SELECT
  up.user_id,
  up.active_client_id,
  COALESCE(up.auto_send_enabled, false),
  ARRAY['live', 'explore', 'crm_import'],
  false,
  1,
  30,
  now(),
  now()
FROM user_profiles up
WHERE NOT EXISTS (
  SELECT 1
  FROM auto_send_policies asp
  WHERE asp.user_id = up.user_id
    AND (
      (asp.client_id IS NULL AND up.active_client_id IS NULL) OR
      asp.client_id = up.active_client_id
    )
);
