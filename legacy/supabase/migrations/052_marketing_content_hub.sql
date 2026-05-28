-- ============================================================
-- 052_marketing_content_hub.sql
-- Content hub channels, custom generation metadata, scheduling.
-- ============================================================

ALTER TABLE gtm_content_ideas
  DROP CONSTRAINT IF EXISTS gtm_content_ideas_content_type_check;

ALTER TABLE gtm_content_ideas
  ADD CONSTRAINT gtm_content_ideas_content_type_check
  CHECK (content_type IN (
    'x_post',
    'linkedin_post',
    'blog_article',
    'video_script',
    'newsletter_blurb',
    'campaign_brief',
    'sales_enablement_note'
  ));

ALTER TABLE gtm_content_ideas
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'social',
  ADD COLUMN IF NOT EXISTS target_platform TEXT,
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'suggested'
    CHECK (origin IN ('suggested', 'custom')),
  ADD COLUMN IF NOT EXISTS custom_prompt TEXT,
  ADD COLUMN IF NOT EXISTS source_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

UPDATE gtm_content_ideas
SET
  channel = CASE
    WHEN content_type IN ('x_post', 'linkedin_post') THEN 'social'
    WHEN content_type IN ('blog_article', 'newsletter_blurb') THEN 'written'
    WHEN content_type = 'video_script' THEN 'video'
    ELSE 'campaign'
  END,
  target_platform = CASE
    WHEN content_type = 'x_post' THEN 'x'
    WHEN content_type = 'linkedin_post' THEN 'linkedin'
    WHEN content_type = 'blog_article' THEN 'blog'
    WHEN content_type = 'video_script' THEN 'youtube'
    WHEN content_type = 'newsletter_blurb' THEN 'newsletter'
    ELSE target_platform
  END
WHERE target_platform IS NULL;

CREATE INDEX IF NOT EXISTS gtm_content_ideas_schedule_idx
  ON gtm_content_ideas(user_id, client_id, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_content_ideas_channel_idx
  ON gtm_content_ideas(user_id, client_id, channel, status, created_at DESC);
