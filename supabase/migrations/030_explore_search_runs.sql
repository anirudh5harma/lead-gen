-- ============================================================
-- 030_explore_search_runs.sql
-- Durable prompted-discovery runs with progress + history
-- ============================================================

CREATE TABLE IF NOT EXISTS explore_search_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  prompt          TEXT NOT NULL,
  icp_hint        TEXT,
  status          TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  source_type     TEXT NOT NULL DEFAULT 'google_news_rss'
    CHECK (source_type IN ('google_news_rss')),
  status_message  TEXT,
  queries         JSONB NOT NULL DEFAULT '[]'::jsonb,
  items_total     INT NOT NULL DEFAULT 0,
  items_processed INT NOT NULL DEFAULT 0,
  inserted_count  INT NOT NULL DEFAULT 0,
  skipped_count   INT NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE explore_search_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own explore search runs"
  ON explore_search_runs FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER explore_search_runs_updated_at
  BEFORE UPDATE ON explore_search_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS explore_search_runs_user_client_created_idx
  ON explore_search_runs(user_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS explore_search_runs_user_status_idx
  ON explore_search_runs(user_id, status, created_at DESC);
