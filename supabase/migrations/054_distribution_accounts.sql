-- ============================================================
-- 054_distribution_accounts.sql
-- Connected marketing distribution accounts and publish jobs.
-- ============================================================

CREATE TABLE IF NOT EXISTS connected_distribution_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id             UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  provider              TEXT NOT NULL CHECK (provider IN ('linkedin', 'x', 'instagram', 'tiktok', 'medium', 'substack')),
  provider_account_id   TEXT,
  display_name          TEXT,
  handle                TEXT,
  access_token          TEXT,
  refresh_token         TEXT,
  token_expires_at      TIMESTAMPTZ,
  scopes                TEXT[] NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'needs_reconnect', 'manual', 'disabled')),
  publish_mode          TEXT NOT NULL DEFAULT 'manual_review'
    CHECK (publish_mode IN ('manual_review', 'scheduled', 'auto_publish')),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_publish_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS connected_distribution_accounts_user_client_provider_account_idx
  ON connected_distribution_accounts(user_id, client_id, provider, provider_account_id)
  WHERE client_id IS NOT NULL AND provider_account_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS connected_distribution_accounts_user_null_client_provider_account_idx
  ON connected_distribution_accounts(user_id, provider, provider_account_id)
  WHERE client_id IS NULL AND provider_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS connected_distribution_accounts_user_provider_idx
  ON connected_distribution_accounts(user_id, client_id, provider, status, created_at DESC);

ALTER TABLE connected_distribution_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own distribution accounts" ON connected_distribution_accounts;
CREATE POLICY "Users manage own distribution accounts"
  ON connected_distribution_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage distribution accounts" ON connected_distribution_accounts;
CREATE POLICY "Service role can manage distribution accounts"
  ON connected_distribution_accounts FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS connected_distribution_accounts_updated_at ON connected_distribution_accounts;
CREATE TRIGGER connected_distribution_accounts_updated_at
  BEFORE UPDATE ON connected_distribution_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS content_distribution_jobs (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                   UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  content_idea_id             UUID REFERENCES gtm_content_ideas(id) ON DELETE CASCADE,
  connected_distribution_account_id UUID REFERENCES connected_distribution_accounts(id) ON DELETE SET NULL,
  provider                    TEXT NOT NULL CHECK (provider IN ('linkedin', 'x', 'instagram', 'tiktok', 'medium', 'substack')),
  status                      TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'publishing', 'published', 'failed', 'cancelled', 'manual_ready')),
  scheduled_for               TIMESTAMPTZ,
  published_at                TIMESTAMPTZ,
  provider_post_id            TEXT,
  payload                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message               TEXT,
  attempt_count               INT NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_distribution_jobs_due_idx
  ON content_distribution_jobs(status, scheduled_for ASC NULLS LAST)
  WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS content_distribution_jobs_user_idx
  ON content_distribution_jobs(user_id, client_id, status, scheduled_for DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS content_distribution_jobs_unique_provider_idea_idx
  ON content_distribution_jobs(content_idea_id, provider)
  WHERE content_idea_id IS NOT NULL;

ALTER TABLE content_distribution_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own content distribution jobs" ON content_distribution_jobs;
CREATE POLICY "Users manage own content distribution jobs"
  ON content_distribution_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage content distribution jobs" ON content_distribution_jobs;
CREATE POLICY "Service role can manage content distribution jobs"
  ON content_distribution_jobs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS content_distribution_jobs_updated_at ON content_distribution_jobs;
CREATE TRIGGER content_distribution_jobs_updated_at
  BEFORE UPDATE ON content_distribution_jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
