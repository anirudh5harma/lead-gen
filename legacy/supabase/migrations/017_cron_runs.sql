-- ============================================================
-- 017_cron_runs.sql
-- Persist cron execution history for operational diagnostics
-- ============================================================

CREATE TABLE IF NOT EXISTS cron_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  metrics       JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage cron runs"
  ON cron_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS cron_runs_job_started_idx
  ON cron_runs(job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS cron_runs_status_started_idx
  ON cron_runs(status, started_at DESC);
