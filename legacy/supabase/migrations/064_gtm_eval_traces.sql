-- ============================================================
-- 064_gtm_eval_traces.sql
-- Workflow-level eval traces + failure taxonomy
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_eval_traces (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id         UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  lead_id           UUID REFERENCES leads(id) ON DELETE SET NULL,
  workflow_run_id   UUID REFERENCES gtm_workflow_runs(id) ON DELETE SET NULL,
  trace_type        TEXT NOT NULL CHECK (trace_type IN (
    'manual_outreach_send',
    'automation_send',
    'followup_send',
    'policy_simulation',
    'draft_quality'
  )),
  status            TEXT NOT NULL CHECK (status IN ('passed', 'blocked', 'failed', 'warning')),
  score             NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  failure_taxonomy  TEXT,
  reasons           TEXT[] NOT NULL DEFAULT '{}',
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_eval_traces_user_created_idx
  ON gtm_eval_traces(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gtm_eval_traces_client_created_idx
  ON gtm_eval_traces(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS gtm_eval_traces_run_idx
  ON gtm_eval_traces(workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_eval_traces_run_type_unique_idx
  ON gtm_eval_traces(workflow_run_id, trace_type)
  WHERE workflow_run_id IS NOT NULL;

ALTER TABLE gtm_eval_traces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view team gtm eval traces" ON gtm_eval_traces FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own gtm eval traces" ON gtm_eval_traces FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage gtm eval traces" ON gtm_eval_traces FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
