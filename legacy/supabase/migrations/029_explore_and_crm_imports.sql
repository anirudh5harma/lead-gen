-- ============================================================
-- 029_explore_and_crm_imports.sql
-- Explore lead origins + universal CRM sync settings/imports
-- ============================================================

ALTER TABLE signals DROP CONSTRAINT IF EXISTS signals_signal_type_check;
ALTER TABLE signals
  ADD CONSTRAINT signals_signal_type_check
  CHECK (signal_type IN ('funding', 'acquisition', 'expansion', 'regulation', 'hiring', 'crm_import'));

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'live';

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_origin_check;
ALTER TABLE leads
  ADD CONSTRAINT leads_origin_check
  CHECK (origin IN ('live', 'explore', 'crm_import'));

CREATE INDEX IF NOT EXISTS leads_user_origin_created_idx
  ON leads(user_id, origin, created_at DESC);

ALTER TABLE crm_sync_settings
  ADD COLUMN IF NOT EXISTS import_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS import_secret TEXT,
  ADD COLUMN IF NOT EXISTS export_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS import_mapping JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE crm_sync_settings
SET import_secret = COALESCE(import_secret, gen_random_uuid()::text)
WHERE import_secret IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_sync_settings_import_secret_idx
  ON crm_sync_settings(import_secret)
  WHERE import_secret IS NOT NULL;

CREATE OR REPLACE FUNCTION consume_lead_quota(p_user_id UUID, p_limit INT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_usage INT;
BEGIN
  SELECT COUNT(*)::int
  INTO current_usage
  FROM leads
  WHERE user_id = p_user_id
    AND origin <> 'crm_import'
    AND is_unlocked = true
    AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days';

  IF current_usage >= p_limit THEN
    UPDATE user_profiles
    SET
      leads_used_this_month = current_usage,
      leads_reset_at = now()
    WHERE user_id = p_user_id;

    RETURN false;
  END IF;

  UPDATE user_profiles
  SET
    leads_used_this_month = current_usage + 1,
    leads_reset_at = now()
  WHERE user_id = p_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION refund_lead_quota(p_user_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE user_profiles
  SET
    leads_used_this_month = (
      SELECT COUNT(*)::int
      FROM leads
      WHERE user_id = p_user_id
        AND origin <> 'crm_import'
        AND is_unlocked = true
        AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days'
    ),
    leads_reset_at = now()
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION recent_lead_count(p_user_id UUID)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int
  FROM leads
  WHERE user_id = p_user_id
    AND origin <> 'crm_import'
    AND is_unlocked = true
    AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days';
$$;
