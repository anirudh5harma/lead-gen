-- ============================================================
-- 042_gtm_infrastructure_mvp.sql
-- AI-native GTM infrastructure spine: entity graph, memory,
-- durable workflow checkpoints, tool-call ledger, policy gates,
-- and integration outbox.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_key         TEXT NOT NULL,
  name                TEXT NOT NULL,
  domain              TEXT,
  website_url         TEXT,
  lifecycle_stage     TEXT NOT NULL DEFAULT 'observed'
    CHECK (lifecycle_stage IN ('observed', 'qualified', 'engaged', 'opportunity', 'customer', 'blocked')),
  source_kind         TEXT NOT NULL DEFAULT 'lead',
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_accounts_user_client_key_idx
  ON gtm_accounts(user_id, client_id, account_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_accounts_user_null_client_key_idx
  ON gtm_accounts(user_id, account_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_accounts_user_client_seen_idx
  ON gtm_accounts(user_id, client_id, last_seen_at DESC);

ALTER TABLE gtm_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm accounts" ON gtm_accounts;
CREATE POLICY "Users can view own gtm accounts"
  ON gtm_accounts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm accounts" ON gtm_accounts;
CREATE POLICY "Service role can manage gtm accounts"
  ON gtm_accounts FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_accounts_updated_at
  BEFORE UPDATE ON gtm_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_people (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES gtm_accounts(id) ON DELETE SET NULL,
  person_key          TEXT NOT NULL,
  email               TEXT,
  name                TEXT,
  title               TEXT,
  seniority           TEXT,
  source_kind         TEXT NOT NULL DEFAULT 'enrichment',
  verified            BOOLEAN NOT NULL DEFAULT false,
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_people_user_client_key_idx
  ON gtm_people(user_id, client_id, person_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_people_user_null_client_key_idx
  ON gtm_people(user_id, person_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_people_account_idx
  ON gtm_people(account_id, last_seen_at DESC)
  WHERE account_id IS NOT NULL;

ALTER TABLE gtm_people ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm people" ON gtm_people;
CREATE POLICY "Users can view own gtm people"
  ON gtm_people FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm people" ON gtm_people;
CREATE POLICY "Service role can manage gtm people"
  ON gtm_people FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_people_updated_at
  BEFORE UPDATE ON gtm_people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_signals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES gtm_accounts(id) ON DELETE CASCADE,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  signal_key          TEXT NOT NULL,
  signal_type         TEXT NOT NULL,
  headline            TEXT NOT NULL,
  summary             TEXT,
  source_url          TEXT,
  source_name         TEXT,
  published_at        TIMESTAMPTZ,
  confidence          NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_signals_user_client_key_idx
  ON gtm_signals(user_id, client_id, signal_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_signals_user_null_client_key_idx
  ON gtm_signals(user_id, signal_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_signals_account_observed_idx
  ON gtm_signals(account_id, observed_at DESC);

ALTER TABLE gtm_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm signals" ON gtm_signals;
CREATE POLICY "Users can view own gtm signals"
  ON gtm_signals FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm signals" ON gtm_signals;
CREATE POLICY "Service role can manage gtm signals"
  ON gtm_signals FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_signals_updated_at
  BEFORE UPDATE ON gtm_signals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  from_entity_type    TEXT NOT NULL,
  from_entity_id      UUID NOT NULL,
  relationship_type   TEXT NOT NULL,
  to_entity_type      TEXT NOT NULL,
  to_entity_id        UUID NOT NULL,
  confidence          NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source              TEXT NOT NULL DEFAULT 'system',
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_relationships_unique_idx
  ON gtm_relationships(user_id, from_entity_type, from_entity_id, relationship_type, to_entity_type, to_entity_id);

CREATE INDEX IF NOT EXISTS gtm_relationships_from_idx
  ON gtm_relationships(from_entity_type, from_entity_id, relationship_type);

CREATE INDEX IF NOT EXISTS gtm_relationships_to_idx
  ON gtm_relationships(to_entity_type, to_entity_id, relationship_type);

ALTER TABLE gtm_relationships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm relationships" ON gtm_relationships;
CREATE POLICY "Users can view own gtm relationships"
  ON gtm_relationships FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm relationships" ON gtm_relationships;
CREATE POLICY "Service role can manage gtm relationships"
  ON gtm_relationships FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_touchpoints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES gtm_accounts(id) ON DELETE SET NULL,
  person_id           UUID REFERENCES gtm_people(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  workflow_run_id     UUID,
  type                TEXT NOT NULL CHECK (type IN ('email', 'followup', 'reply', 'crm_update', 'approval')),
  status              TEXT NOT NULL CHECK (status IN ('planned', 'sent', 'received', 'blocked', 'failed', 'queued')),
  subject             TEXT,
  body_preview        TEXT,
  from_email          TEXT,
  to_email            TEXT,
  provider            TEXT,
  message_id          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_touchpoints_account_time_idx
  ON gtm_touchpoints(account_id, occurred_at DESC)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_touchpoints_lead_time_idx
  ON gtm_touchpoints(lead_id, occurred_at DESC)
  WHERE lead_id IS NOT NULL;

ALTER TABLE gtm_touchpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm touchpoints" ON gtm_touchpoints;
CREATE POLICY "Users can view own gtm touchpoints"
  ON gtm_touchpoints FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm touchpoints" ON gtm_touchpoints;
CREATE POLICY "Service role can manage gtm touchpoints"
  ON gtm_touchpoints FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_memories (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                  UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  memory_scope               TEXT NOT NULL CHECK (memory_scope IN ('run', 'entity', 'workspace', 'performance')),
  entity_type                TEXT,
  entity_id                  UUID,
  memory_type                TEXT NOT NULL,
  content                    TEXT NOT NULL,
  source                     TEXT NOT NULL,
  confidence                 NUMERIC(5,4) NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  observed_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at                 TIMESTAMPTZ,
  provenance                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_agent_run_id    UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  created_by_workflow_run_id UUID,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_memories_entity_idx
  ON gtm_memories(user_id, client_id, entity_type, entity_id, observed_at DESC)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_memories_scope_idx
  ON gtm_memories(user_id, client_id, memory_scope, memory_type, observed_at DESC);

ALTER TABLE gtm_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm memories" ON gtm_memories;
CREATE POLICY "Users can view own gtm memories"
  ON gtm_memories FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm memories" ON gtm_memories;
CREATE POLICY "Service role can manage gtm memories"
  ON gtm_memories FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_entity_embeddings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  entity_type         TEXT NOT NULL,
  entity_id           UUID NOT NULL,
  content_hash        TEXT NOT NULL,
  embedding           VECTOR(1536),
  model               TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  source              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, content_hash)
);

CREATE INDEX IF NOT EXISTS gtm_entity_embeddings_lookup_idx
  ON gtm_entity_embeddings(user_id, client_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS gtm_entity_embeddings_vector_idx
  ON gtm_entity_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE gtm_entity_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm entity embeddings" ON gtm_entity_embeddings;
CREATE POLICY "Users can view own gtm entity embeddings"
  ON gtm_entity_embeddings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm entity embeddings" ON gtm_entity_embeddings;
CREATE POLICY "Service role can manage gtm entity embeddings"
  ON gtm_entity_embeddings FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_workflow_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  agent_run_id        UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  workflow_type       TEXT NOT NULL,
  workflow_key        TEXT,
  status              TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  current_step        TEXT,
  checkpoint          JSONB NOT NULL DEFAULT '{}'::jsonb,
  input               JSONB NOT NULL DEFAULT '{}'::jsonb,
  output              JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message       TEXT,
  idempotency_key     TEXT,
  lease_owner         TEXT,
  lease_expires_at    TIMESTAMPTZ,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_workflow_runs_idempotency_idx
  ON gtm_workflow_runs(user_id, client_id, idempotency_key)
  WHERE client_id IS NOT NULL AND idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_workflow_runs_null_client_idempotency_idx
  ON gtm_workflow_runs(user_id, idempotency_key)
  WHERE client_id IS NULL AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_workflow_runs_user_status_idx
  ON gtm_workflow_runs(user_id, client_id, status, started_at DESC);

ALTER TABLE gtm_workflow_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm workflow runs" ON gtm_workflow_runs;
CREATE POLICY "Users can view own gtm workflow runs"
  ON gtm_workflow_runs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm workflow runs" ON gtm_workflow_runs;
CREATE POLICY "Service role can manage gtm workflow runs"
  ON gtm_workflow_runs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_workflow_runs_updated_at
  BEFORE UPDATE ON gtm_workflow_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_workflow_steps (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID NOT NULL REFERENCES gtm_workflow_runs(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  step_key            TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'skipped', 'blocked')),
  attempt             INT NOT NULL DEFAULT 1,
  input               JSONB NOT NULL DEFAULT '{}'::jsonb,
  output              JSONB NOT NULL DEFAULT '{}'::jsonb,
  checkpoint          JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message       TEXT,
  idempotency_key     TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS gtm_workflow_steps_run_status_idx
  ON gtm_workflow_steps(run_id, status, started_at DESC);

ALTER TABLE gtm_workflow_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm workflow steps" ON gtm_workflow_steps;
CREATE POLICY "Users can view own gtm workflow steps"
  ON gtm_workflow_steps FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm workflow steps" ON gtm_workflow_steps;
CREATE POLICY "Service role can manage gtm workflow steps"
  ON gtm_workflow_steps FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_workflow_steps_updated_at
  BEFORE UPDATE ON gtm_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_agent_checkpoints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID REFERENCES gtm_workflow_runs(id) ON DELETE CASCADE,
  step_id             UUID REFERENCES gtm_workflow_steps(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  checkpoint_key      TEXT NOT NULL,
  state               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_agent_checkpoints_run_key_idx
  ON gtm_agent_checkpoints(run_id, checkpoint_key, created_at DESC);

ALTER TABLE gtm_agent_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm agent checkpoints" ON gtm_agent_checkpoints;
CREATE POLICY "Users can view own gtm agent checkpoints"
  ON gtm_agent_checkpoints FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm agent checkpoints" ON gtm_agent_checkpoints;
CREATE POLICY "Service role can manage gtm agent checkpoints"
  ON gtm_agent_checkpoints FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_agent_tool_calls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              UUID REFERENCES gtm_workflow_runs(id) ON DELETE CASCADE,
  step_id             UUID REFERENCES gtm_workflow_steps(id) ON DELETE SET NULL,
  agent_run_id        UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  tool_name           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'blocked')),
  input               JSONB NOT NULL DEFAULT '{}'::jsonb,
  output              JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message       TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_agent_tool_calls_run_idx
  ON gtm_agent_tool_calls(run_id, started_at DESC);

ALTER TABLE gtm_agent_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm agent tool calls" ON gtm_agent_tool_calls;
CREATE POLICY "Users can view own gtm agent tool calls"
  ON gtm_agent_tool_calls FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm agent tool calls" ON gtm_agent_tool_calls;
CREATE POLICY "Service role can manage gtm agent tool calls"
  ON gtm_agent_tool_calls FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_policy_decisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  run_id              UUID REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL,
  step_id             UUID REFERENCES gtm_workflow_steps(id) ON DELETE SET NULL,
  agent_run_id        UUID REFERENCES agent_runs(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  policy_name         TEXT NOT NULL,
  action_type         TEXT NOT NULL,
  decision            TEXT NOT NULL CHECK (decision IN ('allowed', 'blocked', 'needs_approval')),
  reasons             TEXT[] NOT NULL DEFAULT '{}',
  input               JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  decided_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_policy_decisions_user_idx
  ON gtm_policy_decisions(user_id, client_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS gtm_policy_decisions_lead_idx
  ON gtm_policy_decisions(lead_id, decided_at DESC)
  WHERE lead_id IS NOT NULL;

ALTER TABLE gtm_policy_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm policy decisions" ON gtm_policy_decisions;
CREATE POLICY "Users can view own gtm policy decisions"
  ON gtm_policy_decisions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm policy decisions" ON gtm_policy_decisions;
CREATE POLICY "Service role can manage gtm policy decisions"
  ON gtm_policy_decisions FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS gtm_integration_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  run_id              UUID REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL,
  integration         TEXT NOT NULL,
  action_type         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
  idempotency_key     TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  result              JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message       TEXT,
  attempts            INT NOT NULL DEFAULT 0,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_integration_outbox_idempotency_idx
  ON gtm_integration_outbox(user_id, integration, action_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS gtm_integration_outbox_due_idx
  ON gtm_integration_outbox(status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'failed');

ALTER TABLE gtm_integration_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own gtm integration outbox" ON gtm_integration_outbox;
CREATE POLICY "Users can view own gtm integration outbox"
  ON gtm_integration_outbox FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm integration outbox" ON gtm_integration_outbox;
CREATE POLICY "Service role can manage gtm integration outbox"
  ON gtm_integration_outbox FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER gtm_integration_outbox_updated_at
  BEFORE UPDATE ON gtm_integration_outbox
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gtm_touchpoints_workflow_run_id_fkey'
  ) THEN
    ALTER TABLE gtm_touchpoints
      ADD CONSTRAINT gtm_touchpoints_workflow_run_id_fkey
      FOREIGN KEY (workflow_run_id) REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gtm_memories_created_by_workflow_run_id_fkey'
  ) THEN
    ALTER TABLE gtm_memories
      ADD CONSTRAINT gtm_memories_created_by_workflow_run_id_fkey
      FOREIGN KEY (created_by_workflow_run_id) REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL;
  END IF;
END;
$$;
