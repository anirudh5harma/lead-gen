-- ============================================================
-- 046_gtm_data_spine.sql
-- Phase 1 shared GTM data spine: canonical events, source
-- registry, and durable user/action work queue.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  entity_type       TEXT,
  entity_id         UUID,
  event_type        TEXT NOT NULL,
  event_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  source            TEXT NOT NULL DEFAULT 'system',
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_events_idempotency_idx
  ON gtm_events(source, event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_events_user_client_time_idx
  ON gtm_events(user_id, client_id, event_time DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_events_entity_time_idx
  ON gtm_events(entity_type, entity_id, event_time DESC)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_events_type_time_idx
  ON gtm_events(event_type, event_time DESC);

ALTER TABLE gtm_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm events" ON gtm_events;
CREATE POLICY "Users can view own gtm events"
  ON gtm_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own gtm events" ON gtm_events;
CREATE POLICY "Users can insert own gtm events"
  ON gtm_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm events" ON gtm_events;
CREATE POLICY "Service role can manage gtm events"
  ON gtm_events FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_sources (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  source_key               TEXT NOT NULL,
  source_type              TEXT NOT NULL DEFAULT 'unknown',
  label                    TEXT NOT NULL,
  url                      TEXT,
  category                 TEXT,
  enabled                  BOOLEAN NOT NULL DEFAULT true,
  poll_frequency_minutes   INT NOT NULL DEFAULT 720 CHECK (poll_frequency_minutes > 0),
  priority                 INT NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  cost_model               JSONB NOT NULL DEFAULT '{}'::jsonb,
  attributes               JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_sources_user_client_key_idx
  ON gtm_sources(user_id, client_id, source_key)
  WHERE user_id IS NOT NULL AND client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_sources_user_null_client_key_idx
  ON gtm_sources(user_id, source_key)
  WHERE user_id IS NOT NULL AND client_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_sources_global_key_idx
  ON gtm_sources(source_key)
  WHERE user_id IS NULL AND client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_sources_enabled_priority_idx
  ON gtm_sources(enabled, priority DESC, last_seen_at DESC);

ALTER TABLE gtm_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm sources" ON gtm_sources;
CREATE POLICY "Users can view own gtm sources"
  ON gtm_sources FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm sources" ON gtm_sources;
CREATE POLICY "Service role can manage gtm sources"
  ON gtm_sources FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_sources_updated_at ON gtm_sources;
CREATE TRIGGER gtm_sources_updated_at
  BEFORE UPDATE ON gtm_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_actions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES gtm_accounts(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  workflow_run_id     UUID REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL,
  action_type         TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'workspace',
  title               TEXT NOT NULL,
  body                TEXT,
  priority            INT NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  status              TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'waiting', 'blocked', 'completed', 'dismissed', 'failed')),
  due_at              TIMESTAMPTZ,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  result              JSONB NOT NULL DEFAULT '{}'::jsonb,
  source              TEXT NOT NULL DEFAULT 'system',
  source_item_key     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_actions_user_client_source_item_idx
  ON gtm_actions(user_id, client_id, source_item_key)
  WHERE client_id IS NOT NULL AND source_item_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_actions_user_null_client_source_item_idx
  ON gtm_actions(user_id, source_item_key)
  WHERE client_id IS NULL AND source_item_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_actions_user_status_priority_idx
  ON gtm_actions(user_id, client_id, status, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS gtm_actions_lead_idx
  ON gtm_actions(lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

ALTER TABLE gtm_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gtm actions" ON gtm_actions;
CREATE POLICY "Users can manage own gtm actions"
  ON gtm_actions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm actions" ON gtm_actions;
CREATE POLICY "Service role can manage gtm actions"
  ON gtm_actions FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_actions_updated_at ON gtm_actions;
CREATE TRIGGER gtm_actions_updated_at
  BEFORE UPDATE ON gtm_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
