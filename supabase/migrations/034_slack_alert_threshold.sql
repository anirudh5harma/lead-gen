-- ============================================================
-- 034_slack_alert_threshold.sql
-- User-configurable Slack alert relevance threshold
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS slack_min_score INT NOT NULL DEFAULT 7
    CHECK (slack_min_score BETWEEN 1 AND 10);
