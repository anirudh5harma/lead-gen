-- ============================================================
-- 065_two_engines_phase1.sql
-- Bombsell v2 Phase 1: per-workspace agent config + per-workspace
-- reward-loop tables. See PLAN.md §3.
-- ============================================================

-- ── workspace_agents ──────────────────────────────────────────
-- One row per (workspace, agent role). `workspace_id` is either a
-- client_accounts.id (team workspace) or an auth.users.id (solo).
-- We keep it FK-free on purpose so both kinds of owner work.
CREATE TABLE IF NOT EXISTS workspace_agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_role    TEXT NOT NULL,
  engine        TEXT NOT NULL CHECK (engine IN ('outbound', 'content', 'shared')),
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  autonomy      TEXT NOT NULL DEFAULT 'approve_first'
                CHECK (autonomy IN ('research_only', 'approve_first', 'autopilot')),
  config        JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_run_at   TIMESTAMPTZ,
  health        TEXT NOT NULL DEFAULT 'idle',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_agents_ws_role_unique_idx
  ON workspace_agents(workspace_id, agent_role);

CREATE INDEX IF NOT EXISTS workspace_agents_ws_engine_idx
  ON workspace_agents(workspace_id, engine);

CREATE INDEX IF NOT EXISTS workspace_agents_user_idx
  ON workspace_agents(user_id);

ALTER TABLE workspace_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_agents_owner ON workspace_agents;
CREATE POLICY workspace_agents_owner ON workspace_agents
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── gtm_icp_signals (per-workspace ICP signal weights) ────────
-- Referenced by the reward loop; create-if-missing and add workspace scope.
CREATE TABLE IF NOT EXISTS gtm_icp_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  signal_type   TEXT NOT NULL,
  name          TEXT,
  weight        NUMERIC(6, 3) NOT NULL DEFAULT 1.0,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gtm_icp_signals ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE gtm_icp_signals ADD COLUMN IF NOT EXISTS signal_type TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_icp_signals_ws_type_unique_idx
  ON gtm_icp_signals(workspace_id, signal_type)
  WHERE workspace_id IS NOT NULL;

ALTER TABLE gtm_icp_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gtm_icp_signals_owner ON gtm_icp_signals;
CREATE POLICY gtm_icp_signals_owner ON gtm_icp_signals
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── agent_tuning_hints (per-workspace, per-engine) ────────────
CREATE TABLE IF NOT EXISTS agent_tuning_hints (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  engine         TEXT CHECK (engine IN ('outbound', 'content', 'shared')),
  agent_name     TEXT,
  agent_role     TEXT,
  signal_type    TEXT,
  hint_type      TEXT,
  new_weight     NUMERIC(6, 3),
  new_priority   NUMERIC(6, 3),
  confidence     NUMERIC(5, 3),
  rationale      TEXT,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agent_tuning_hints ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE agent_tuning_hints ADD COLUMN IF NOT EXISTS engine TEXT;
ALTER TABLE agent_tuning_hints ADD COLUMN IF NOT EXISTS rationale TEXT;
ALTER TABLE agent_tuning_hints ADD COLUMN IF NOT EXISTS confidence NUMERIC(5, 3);

CREATE INDEX IF NOT EXISTS agent_tuning_hints_ws_created_idx
  ON agent_tuning_hints(workspace_id, created_at DESC);

ALTER TABLE agent_tuning_hints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_tuning_hints_owner ON agent_tuning_hints;
CREATE POLICY agent_tuning_hints_owner ON agent_tuning_hints
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── workspace_tuning_log (human-readable "what changed & why") ─
CREATE TABLE IF NOT EXISTS workspace_tuning_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  engine        TEXT NOT NULL CHECK (engine IN ('outbound', 'content', 'shared')),
  summary       TEXT NOT NULL,
  changes       JSONB NOT NULL DEFAULT '[]'::jsonb,
  cycle_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_tuning_log_ws_idx
  ON workspace_tuning_log(workspace_id, cycle_at DESC);

ALTER TABLE workspace_tuning_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_tuning_log_owner ON workspace_tuning_log;
CREATE POLICY workspace_tuning_log_owner ON workspace_tuning_log
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
