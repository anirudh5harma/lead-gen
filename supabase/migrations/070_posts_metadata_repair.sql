-- ============================================================
-- 070_posts_metadata_repair.sql
-- The PostForMe content writer stores provider details on posts.
-- Reassert the column for databases created from migration 066.
-- ============================================================

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
