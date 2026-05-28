-- ============================================================
-- 058_avatar_video_jobs_table.sql
-- Dedicated forward migration for avatar video job tracking.
-- This intentionally repeats the table definition from the
-- bundled marketing workflow migration so deployments that missed
-- that table can recover safely with IF NOT EXISTS.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_avatar_video_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  content_idea_id     UUID NOT NULL REFERENCES gtm_content_ideas(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'manual_ready',
  status              TEXT NOT NULL DEFAULT 'manual_ready'
    CHECK (status IN ('manual_ready', 'queued', 'rendering', 'ready', 'failed')),
  script              TEXT NOT NULL,
  caption             TEXT NOT NULL DEFAULT '',
  video_url           TEXT,
  thumbnail_url       TEXT,
  provider_job_id     TEXT,
  error_message       TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_avatar_video_jobs_idea_idx
  ON gtm_avatar_video_jobs(content_idea_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gtm_avatar_video_jobs_status_idx
  ON gtm_avatar_video_jobs(status, updated_at ASC, created_at ASC)
  WHERE status IN ('queued', 'rendering');

ALTER TABLE gtm_avatar_video_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own avatar video jobs" ON gtm_avatar_video_jobs;
CREATE POLICY "Users manage own avatar video jobs"
  ON gtm_avatar_video_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage avatar video jobs" ON gtm_avatar_video_jobs;
CREATE POLICY "Service role can manage avatar video jobs"
  ON gtm_avatar_video_jobs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_avatar_video_jobs_updated_at ON gtm_avatar_video_jobs;
CREATE TRIGGER gtm_avatar_video_jobs_updated_at
  BEFORE UPDATE ON gtm_avatar_video_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
