-- ============================================================
-- 055_marketing_production_workflow.sql
-- Daily marketing suggestions, draft controls, media assets,
-- and inspiration metadata for production content workflows.
-- ============================================================

ALTER TABLE gtm_content_ideas
  ADD COLUMN IF NOT EXISTS tab TEXT
    CHECK (tab IN ('posts', 'blogs', 'videos')),
  ADD COLUMN IF NOT EXISTS batch_date DATE,
  ADD COLUMN IF NOT EXISTS suggestion_rank INT,
  ADD COLUMN IF NOT EXISTS draft_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS final_body TEXT,
  ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS compliance_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE gtm_content_ideas
SET
  tab = CASE
    WHEN content_type IN ('x_post', 'linkedin_post') THEN 'posts'
    WHEN content_type IN ('blog_article', 'newsletter_blurb') THEN 'blogs'
    WHEN content_type = 'video_script' THEN 'videos'
    ELSE tab
  END,
  batch_date = COALESCE(batch_date, created_at::date)
WHERE tab IS NULL OR batch_date IS NULL;

CREATE INDEX IF NOT EXISTS gtm_content_ideas_daily_tab_idx
  ON gtm_content_ideas(user_id, client_id, batch_date, tab, origin, status, suggestion_rank ASC NULLS LAST, score DESC);

CREATE INDEX IF NOT EXISTS gtm_content_ideas_calendar_idx
  ON gtm_content_ideas(user_id, client_id, scheduled_for, tab, target_platform)
  WHERE scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS gtm_content_assets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  content_idea_id     UUID REFERENCES gtm_content_ideas(id) ON DELETE CASCADE,
  asset_type          TEXT NOT NULL CHECK (asset_type IN ('link', 'image', 'video', 'thumbnail', 'document', 'note')),
  label               TEXT NOT NULL DEFAULT 'Asset',
  url                 TEXT,
  text_value          TEXT,
  mime_type           TEXT,
  storage_path        TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_content_assets_idea_idx
  ON gtm_content_assets(content_idea_id, created_at DESC);

ALTER TABLE gtm_content_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own content assets" ON gtm_content_assets;
CREATE POLICY "Users manage own content assets"
  ON gtm_content_assets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage content assets" ON gtm_content_assets;
CREATE POLICY "Service role can manage content assets"
  ON gtm_content_assets FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_content_inspiration_refs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  industry            TEXT,
  platform            TEXT NOT NULL,
  source_url          TEXT,
  source_title        TEXT NOT NULL,
  pattern_summary     TEXT NOT NULL,
  engagement_score    NUMERIC(8,2) NOT NULL DEFAULT 0,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS gtm_content_inspiration_refs_recent_idx
  ON gtm_content_inspiration_refs(user_id, client_id, industry, captured_at DESC, engagement_score DESC);

ALTER TABLE gtm_content_inspiration_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own inspiration refs" ON gtm_content_inspiration_refs;
CREATE POLICY "Users view own inspiration refs"
  ON gtm_content_inspiration_refs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage inspiration refs" ON gtm_content_inspiration_refs;
CREATE POLICY "Service role can manage inspiration refs"
  ON gtm_content_inspiration_refs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_content_draft_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  tab                 TEXT NOT NULL CHECK (tab IN ('posts', 'blogs', 'videos')),
  settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
  time_zone           TEXT NOT NULL DEFAULT 'UTC',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_draft_preferences_user_client_tab_idx
  ON gtm_content_draft_preferences(user_id, client_id, tab)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_draft_preferences_user_null_client_tab_idx
  ON gtm_content_draft_preferences(user_id, tab)
  WHERE client_id IS NULL;

ALTER TABLE gtm_content_draft_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own draft preferences" ON gtm_content_draft_preferences;
CREATE POLICY "Users manage own draft preferences"
  ON gtm_content_draft_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage draft preferences" ON gtm_content_draft_preferences;
CREATE POLICY "Service role can manage draft preferences"
  ON gtm_content_draft_preferences FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_content_draft_preferences_updated_at ON gtm_content_draft_preferences;
CREATE TRIGGER gtm_content_draft_preferences_updated_at
  BEFORE UPDATE ON gtm_content_draft_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'marketing-content-assets',
  'marketing-content-assets',
  true,
  104857600,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'application/pdf', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users manage own marketing content asset objects" ON storage.objects;
CREATE POLICY "Users manage own marketing content asset objects"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'marketing-content-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'marketing-content-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Public can read marketing content asset objects" ON storage.objects;
CREATE POLICY "Public can read marketing content asset objects"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'marketing-content-assets');
