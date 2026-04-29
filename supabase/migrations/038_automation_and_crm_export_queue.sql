-- ============================================================
-- 038_automation_and_crm_export_queue.sql
-- Export-only CRM queue + safer outbound automation controls
-- ============================================================

ALTER TABLE auto_send_policies
  ADD COLUMN IF NOT EXISTS target_explore_session_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS daily_send_limit INT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS min_minutes_between_sends INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS last_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_notification_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_notification_sent_at TIMESTAMPTZ;

ALTER TABLE auto_send_policies
  DROP CONSTRAINT IF EXISTS auto_send_policies_daily_send_limit_check;

ALTER TABLE auto_send_policies
  ADD CONSTRAINT auto_send_policies_daily_send_limit_check
  CHECK (daily_send_limit BETWEEN 1 AND 50);

ALTER TABLE auto_send_policies
  DROP CONSTRAINT IF EXISTS auto_send_policies_min_minutes_between_sends_check;

ALTER TABLE auto_send_policies
  ADD CONSTRAINT auto_send_policies_min_minutes_between_sends_check
  CHECK (min_minutes_between_sends BETWEEN 5 AND 1440);

UPDATE auto_send_policies
SET target_origins = ARRAY['live', 'explore']
WHERE target_origins IS NULL
   OR target_origins = '{}'
   OR 'crm_import' = ANY(target_origins);

UPDATE crm_sync_settings
SET import_enabled = false
WHERE import_enabled = true;
