-- ============================================================
-- 045_gtm_work_item_actions.sql
-- Durable review actions for generated GTM work items.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_work_item_actions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id      UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  item_key       TEXT NOT NULL,
  lead_id        UUID REFERENCES leads(id) ON DELETE SET NULL,
  action         TEXT NOT NULL CHECK (action IN ('reviewed', 'approved', 'discussed', 'dismissed')),
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_work_item_actions_user_client_item_action_idx
  ON gtm_work_item_actions(user_id, client_id, item_key, action)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_work_item_actions_user_null_client_item_action_idx
  ON gtm_work_item_actions(user_id, item_key, action)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_work_item_actions_user_time_idx
  ON gtm_work_item_actions(user_id, client_id, created_at DESC);

ALTER TABLE gtm_work_item_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gtm work item actions" ON gtm_work_item_actions;
CREATE POLICY "Users can manage own gtm work item actions"
  ON gtm_work_item_actions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm work item actions" ON gtm_work_item_actions;
CREATE POLICY "Service role can manage gtm work item actions"
  ON gtm_work_item_actions FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
