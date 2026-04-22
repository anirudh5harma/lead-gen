-- ============================================================
-- 016_subscription_workspace_warning.sql
-- Track one downgrade-warning email per billing cycle
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS workspace_downgrade_warning_sent_at TIMESTAMPTZ;

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS workspace_downgrade_warning_cycle_at TIMESTAMPTZ;
