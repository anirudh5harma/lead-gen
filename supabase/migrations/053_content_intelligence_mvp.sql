-- ============================================================
-- 053_content_intelligence_mvp.sql
-- Context snapshots, content pillars, scoring, and feedback
-- memory for creative marketing suggestions.
-- ============================================================

ALTER TABLE gtm_content_ideas
  ADD COLUMN IF NOT EXISTS pillar TEXT,
  ADD COLUMN IF NOT EXISTS idea_format TEXT,
  ADD COLUMN IF NOT EXISTS why_now TEXT,
  ADD COLUMN IF NOT EXISTS source_insights JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS score NUMERIC(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scoring_debug JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS gtm_content_ideas_score_idx
  ON gtm_content_ideas(user_id, client_id, status, score DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS gtm_content_context_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  snapshot_key   TEXT NOT NULL,
  context        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_context_snapshots_user_client_key_idx
  ON gtm_content_context_snapshots(user_id, client_id, snapshot_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_context_snapshots_user_null_client_key_idx
  ON gtm_content_context_snapshots(user_id, snapshot_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_content_context_snapshots_recent_idx
  ON gtm_content_context_snapshots(user_id, client_id, created_at DESC);

ALTER TABLE gtm_content_context_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own content context snapshots" ON gtm_content_context_snapshots;
CREATE POLICY "Users can view own content context snapshots"
  ON gtm_content_context_snapshots FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage content context snapshots" ON gtm_content_context_snapshots;
CREATE POLICY "Service role can manage content context snapshots"
  ON gtm_content_context_snapshots FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_content_pillars (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  pillar_key     TEXT NOT NULL,
  title          TEXT NOT NULL,
  audience       TEXT NOT NULL,
  pain           TEXT NOT NULL,
  belief         TEXT NOT NULL,
  proof_sources  JSONB NOT NULL DEFAULT '[]'::jsonb,
  formats        TEXT[] NOT NULL DEFAULT '{}',
  confidence     NUMERIC(5,4) NOT NULL DEFAULT 0.7 CHECK (confidence >= 0 AND confidence <= 1),
  last_used_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_pillars_user_client_key_idx
  ON gtm_content_pillars(user_id, client_id, pillar_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_pillars_user_null_client_key_idx
  ON gtm_content_pillars(user_id, pillar_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_content_pillars_recent_idx
  ON gtm_content_pillars(user_id, client_id, updated_at DESC);

ALTER TABLE gtm_content_pillars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own content pillars" ON gtm_content_pillars;
CREATE POLICY "Users can view own content pillars"
  ON gtm_content_pillars FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage content pillars" ON gtm_content_pillars;
CREATE POLICY "Service role can manage content pillars"
  ON gtm_content_pillars FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_content_pillars_updated_at ON gtm_content_pillars;
CREATE TRIGGER gtm_content_pillars_updated_at
  BEFORE UPDATE ON gtm_content_pillars
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_content_feedback_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  content_idea_id     UUID REFERENCES gtm_content_ideas(id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL CHECK (event_type IN ('drafted', 'approved', 'dismissed', 'scheduled', 'unscheduled', 'custom_created')),
  content_type        TEXT,
  pillar              TEXT,
  idea_format         TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_content_feedback_events_user_idx
  ON gtm_content_feedback_events(user_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gtm_content_feedback_events_idea_idx
  ON gtm_content_feedback_events(content_idea_id, created_at DESC);

ALTER TABLE gtm_content_feedback_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own content feedback events" ON gtm_content_feedback_events;
CREATE POLICY "Users can view own content feedback events"
  ON gtm_content_feedback_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage content feedback events" ON gtm_content_feedback_events;
CREATE POLICY "Service role can manage content feedback events"
  ON gtm_content_feedback_events FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
