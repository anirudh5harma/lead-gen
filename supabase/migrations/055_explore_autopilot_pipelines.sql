-- ============================================================
-- 055_explore_autopilot_pipelines.sql
-- Add per-session autopilot tracking, explore pipeline quotas,
-- and origin-aware query indexes for unified pipeline fairness.
-- ============================================================

-- 1. Explore run autopilot lifecycle tracking
ALTER TABLE explore_runs
  ADD COLUMN IF NOT EXISTS autopilot_status TEXT NOT NULL DEFAULT 'generated'
  CHECK (autopilot_status IN ('generated', 'queued', 'sending', 'completed', 'paused')),
  ADD COLUMN IF NOT EXISTS autopilot_added_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autopilot_removed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS explore_runs_user_autopilot_status_idx
  ON explore_runs(user_id, client_id, autopilot_status, created_at DESC);

-- 2. Pipeline fairness: separate sub-limit for explore sessions
ALTER TABLE auto_send_policies
  ADD COLUMN IF NOT EXISTS explore_daily_send_limit INT NOT NULL DEFAULT 3
  CHECK (explore_daily_send_limit BETWEEN 0 AND 50);

-- 3. Performance indexes for cron queries
CREATE INDEX IF NOT EXISTS leads_user_origin_session_status_idx
  ON leads(user_id, client_id, origin, feed_session_id, status)
  WHERE origin = 'explore';

CREATE INDEX IF NOT EXISTS leads_user_origin_sent_at_idx
  ON leads(user_id, client_id, origin, sent_at)
  WHERE sent_at IS NOT NULL;

-- 4. Backfill existing explore runs
UPDATE explore_runs
SET autopilot_status = 'generated'
WHERE autopilot_status IS NULL;
