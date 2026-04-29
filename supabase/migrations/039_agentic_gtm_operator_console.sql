-- ============================================================
-- 039_agentic_gtm_operator_console.sql
-- Agentic GTM event ledger and operator-console primitives.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  agent_name     TEXT NOT NULL,
  run_type       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ,
  input          JSONB NOT NULL DEFAULT '{}'::jsonb,
  output         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message  TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_user_client_started_idx
  ON agent_runs(user_id, client_id, started_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own agent runs" ON agent_runs;
CREATE POLICY "Users can view own agent runs"
  ON agent_runs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage agent runs" ON agent_runs;
CREATE POLICY "Service role can manage agent runs"
  ON agent_runs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS agent_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  run_id         UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  lead_id        UUID REFERENCES leads(id) ON DELETE SET NULL,
  agent_name     TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  status         TEXT NOT NULL
    CHECK (status IN ('planned', 'running', 'completed', 'skipped', 'blocked', 'failed', 'needs_approval')),
  title          TEXT NOT NULL,
  body           TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_events_user_client_created_idx
  ON agent_events(user_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_events_lead_created_idx
  ON agent_events(lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own agent events" ON agent_events;
CREATE POLICY "Users can view own agent events"
  ON agent_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage agent events" ON agent_events;
CREATE POLICY "Service role can manage agent events"
  ON agent_events FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS automation_mode TEXT NOT NULL DEFAULT 'approve_first'
    CHECK (automation_mode IN ('research_only', 'approve_first', 'autopilot'));

CREATE INDEX IF NOT EXISTS leads_operator_outcomes_idx
  ON leads(user_id, client_id, status, sent_at DESC, replied_at DESC, booked_at DESC, created_at DESC);
