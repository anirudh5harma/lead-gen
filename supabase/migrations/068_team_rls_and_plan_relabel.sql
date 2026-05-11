-- ============================================================
-- 068_team_rls_and_plan_relabel.sql
-- v2 tables: make RLS workspace-aware (team members see shared rows);
-- relabel legacy plan values onto Launch / Team. See PLAN.md.
-- ============================================================

-- ── helper: can the user access this workspace? ───────────────
-- workspace_id is either a personal id (= auth.users.id) or a client_accounts.id.
CREATE OR REPLACE FUNCTION can_access_workspace(p_user_id UUID, p_workspace_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF p_workspace_id = p_user_id THEN RETURN TRUE; END IF;
  IF EXISTS (SELECT 1 FROM client_accounts WHERE id = p_workspace_id AND user_id = p_user_id) THEN RETURN TRUE; END IF;
  IF EXISTS (SELECT 1 FROM workspace_members WHERE client_id = p_workspace_id AND user_id = p_user_id AND accepted_at IS NOT NULL) THEN RETURN TRUE; END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ── re-point v2 table policies onto the workspace check ───────
-- workspace_agents
DROP POLICY IF EXISTS workspace_agents_owner ON workspace_agents;
CREATE POLICY workspace_agents_ws ON workspace_agents
  FOR ALL USING (can_access_workspace(auth.uid(), workspace_id))
  WITH CHECK (can_access_workspace(auth.uid(), workspace_id));

-- content_ideas
DROP POLICY IF EXISTS content_ideas_owner ON content_ideas;
CREATE POLICY content_ideas_ws ON content_ideas
  FOR ALL USING (can_access_workspace(auth.uid(), workspace_id))
  WITH CHECK (can_access_workspace(auth.uid(), workspace_id));

-- posts
DROP POLICY IF EXISTS posts_owner ON posts;
CREATE POLICY posts_ws ON posts
  FOR ALL USING (can_access_workspace(auth.uid(), workspace_id))
  WITH CHECK (can_access_workspace(auth.uid(), workspace_id));

-- social_accounts
DROP POLICY IF EXISTS social_accounts_owner ON social_accounts;
CREATE POLICY social_accounts_ws ON social_accounts
  FOR ALL USING (can_access_workspace(auth.uid(), workspace_id))
  WITH CHECK (can_access_workspace(auth.uid(), workspace_id));

-- workspace_llm_keys
DROP POLICY IF EXISTS workspace_llm_keys_owner ON workspace_llm_keys;
CREATE POLICY workspace_llm_keys_ws ON workspace_llm_keys
  FOR ALL USING (can_access_workspace(auth.uid(), workspace_id))
  WITH CHECK (can_access_workspace(auth.uid(), workspace_id));

-- workspace_tuning_log
DROP POLICY IF EXISTS workspace_tuning_log_owner ON workspace_tuning_log;
CREATE POLICY workspace_tuning_log_ws ON workspace_tuning_log
  FOR ALL USING (can_access_workspace(auth.uid(), workspace_id))
  WITH CHECK (can_access_workspace(auth.uid(), workspace_id));

-- gtm_icp_signals (workspace-scoped rows; legacy user-scoped rows still gated by user_id)
DROP POLICY IF EXISTS gtm_icp_signals_owner ON gtm_icp_signals;
CREATE POLICY gtm_icp_signals_ws ON gtm_icp_signals
  FOR ALL USING (user_id = auth.uid() OR (workspace_id IS NOT NULL AND can_access_workspace(auth.uid(), workspace_id)))
  WITH CHECK (user_id = auth.uid() OR (workspace_id IS NOT NULL AND can_access_workspace(auth.uid(), workspace_id)));

-- agent_tuning_hints
DROP POLICY IF EXISTS agent_tuning_hints_owner ON agent_tuning_hints;
CREATE POLICY agent_tuning_hints_ws ON agent_tuning_hints
  FOR ALL USING (user_id = auth.uid() OR (workspace_id IS NOT NULL AND can_access_workspace(auth.uid(), workspace_id)))
  WITH CHECK (user_id = auth.uid() OR (workspace_id IS NOT NULL AND can_access_workspace(auth.uid(), workspace_id)));

-- credit_ledger (read for workspace members; inserts still owner-scoped)
DROP POLICY IF EXISTS credit_ledger_select ON credit_ledger;
CREATE POLICY credit_ledger_select ON credit_ledger
  FOR SELECT USING (can_access_workspace(auth.uid(), workspace_id));

-- ── widen plan CHECK constraints to accept v2 tiers ───────────
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_plan_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_plan_check
  CHECK (plan IN ('free', 'launch', 'team', 'growth', 'scale', 'enterprise'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') THEN
    EXECUTE 'ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check';
    EXECUTE 'ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN (''free'', ''launch'', ''team'', ''growth'', ''scale'', ''enterprise''))';
  END IF;
END $$;

-- ── relabel legacy plan values onto v2 tiers ──────────────────
UPDATE user_profiles SET plan = 'launch', monthly_credit_grant = GREATEST(monthly_credit_grant, 100) WHERE plan = 'growth';
UPDATE user_profiles SET plan = 'team',   monthly_credit_grant = GREATEST(monthly_credit_grant, 350) WHERE plan IN ('scale', 'enterprise');
-- 'free' stays 'free' (no paid plan); they upgrade to launch/team via checkout.
