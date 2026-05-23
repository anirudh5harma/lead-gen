-- ============================================================
-- 057_team_workspace.sql
-- Team workspaces, shared memory, lead assignment, activity log
-- ============================================================

-- 1. Workspace members
CREATE TABLE IF NOT EXISTS workspace_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  invited_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email   TEXT NOT NULL,
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  UNIQUE(client_id, invited_email)
);

CREATE INDEX IF NOT EXISTS workspace_members_client_idx
  ON workspace_members(client_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS workspace_members_user_idx
  ON workspace_members(user_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS workspace_members_invited_email_idx
  ON workspace_members(invited_email, accepted_at DESC);

-- Helper functions to avoid infinite recursion in workspace_members RLS
CREATE OR REPLACE FUNCTION is_workspace_member(p_user_id UUID, p_client_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE client_id = p_client_id
      AND user_id = p_user_id
      AND accepted_at IS NOT NULL
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_workspace_admin_or_owner(p_user_id UUID, p_client_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM client_accounts
    WHERE id = p_client_id AND user_id = p_user_id
  )
  OR EXISTS (
    SELECT 1 FROM workspace_members
    WHERE client_id = p_client_id
      AND user_id = p_user_id
      AND accepted_at IS NOT NULL
      AND role IN ('owner', 'admin')
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspace members"
  ON workspace_members FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() = invited_by
    OR is_workspace_member(auth.uid(), client_id)
  );

CREATE POLICY "Owners and admins can manage workspace members"
  ON workspace_members FOR ALL
  USING (
    is_workspace_admin_or_owner(auth.uid(), client_id)
  );

-- 2. Invite tokens for email invites
CREATE TABLE IF NOT EXISTS workspace_invite_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT NOT NULL UNIQUE,
  client_id     UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  invited_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_invite_tokens_token_idx
  ON workspace_invite_tokens(token);

CREATE INDEX IF NOT EXISTS workspace_invite_tokens_client_idx
  ON workspace_invite_tokens(client_id, created_at DESC);

ALTER TABLE workspace_invite_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage invite tokens"
  ON workspace_invite_tokens FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Team activity log
CREATE TABLE IF NOT EXISTS workspace_activity (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action_type   TEXT NOT NULL CHECK (action_type IN (
    'lead_unlocked', 'lead_assigned', 'email_sent', 'email_replied',
    'meeting_booked', 'lead_dismissed', 'account_viewed', 'template_created',
    'member_joined', 'member_invited', 'member_removed'
  )),
  entity_type   TEXT,
  entity_id     UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_activity_client_idx
  ON workspace_activity(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_activity_user_idx
  ON workspace_activity(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_activity_entity_idx
  ON workspace_activity(entity_type, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;

ALTER TABLE workspace_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can view activity"
  ON workspace_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.client_id = workspace_activity.client_id
        AND wm.user_id = auth.uid()
        AND wm.accepted_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM client_accounts ca
      WHERE ca.id = workspace_activity.client_id
        AND ca.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role can write activity"
  ON workspace_activity FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Lead assignment
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS leads_assigned_user_idx
  ON leads(assigned_user_id, created_at DESC)
  WHERE assigned_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_client_assigned_idx
  ON leads(client_id, assigned_user_id, created_at DESC);

-- 5. Workspace-level billing support (future-proofing)
ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS is_team_workspace BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS max_team_members INT NOT NULL DEFAULT 1;

UPDATE client_accounts
SET billing_user_id = user_id
WHERE billing_user_id IS NULL;

-- 6. Helper function: get user's accessible workspace IDs
CREATE OR REPLACE FUNCTION get_user_workspace_ids(p_user_id UUID)
RETURNS TABLE(client_id UUID) AS $$
  SELECT ca.id FROM client_accounts ca WHERE ca.user_id = p_user_id
  UNION
  SELECT wm.client_id FROM workspace_members wm
  WHERE wm.user_id = p_user_id AND wm.accepted_at IS NOT NULL;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 7. Helper function: get user's active workspace billing owner
CREATE OR REPLACE FUNCTION get_workspace_billing_user_id(p_user_id UUID)
RETURNS UUID AS $$
  SELECT COALESCE(ca.billing_user_id, p_user_id)
  FROM user_profiles up
  LEFT JOIN client_accounts ca ON ca.id = up.active_client_id
  WHERE up.user_id = p_user_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- 8. Update RLS policies for leads (team read access)
DROP POLICY IF EXISTS "Users can view own leads" ON leads;
DROP POLICY IF EXISTS "Users can manage own leads" ON leads;

CREATE POLICY "Users can view team leads" ON leads FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own leads" ON leads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage leads" ON leads FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 9. Update RLS for gtm_accounts (team access)
DROP POLICY IF EXISTS "Users can view own gtm accounts" ON gtm_accounts;
DROP POLICY IF EXISTS "Users can manage own gtm accounts" ON gtm_accounts;
DROP POLICY IF EXISTS "Service role can manage gtm accounts" ON gtm_accounts;

CREATE POLICY "Users can view team gtm accounts" ON gtm_accounts FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own gtm accounts" ON gtm_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage gtm accounts" ON gtm_accounts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 10. Update RLS for gtm_memories (shared memory)
DROP POLICY IF EXISTS "Users can view own gtm memories" ON gtm_memories;
DROP POLICY IF EXISTS "Service role can manage gtm memories" ON gtm_memories;

CREATE POLICY "Users can view team gtm memories" ON gtm_memories FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own gtm memories" ON gtm_memories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage gtm memories" ON gtm_memories FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 11. Update RLS for gtm_signals, gtm_people, gtm_touchpoints, gtm_relationships
DROP POLICY IF EXISTS "Users can view own gtm signals" ON gtm_signals;
CREATE POLICY "Users can view team gtm signals" ON gtm_signals FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage own gtm signals" ON gtm_signals;
CREATE POLICY "Users can manage own gtm signals" ON gtm_signals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own gtm people" ON gtm_people;
CREATE POLICY "Users can view team gtm people" ON gtm_people FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage own gtm people" ON gtm_people;
CREATE POLICY "Users can manage own gtm people" ON gtm_people FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own gtm touchpoints" ON gtm_touchpoints;
CREATE POLICY "Users can view team gtm touchpoints" ON gtm_touchpoints FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage own gtm touchpoints" ON gtm_touchpoints;
CREATE POLICY "Users can manage own gtm touchpoints" ON gtm_touchpoints FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own gtm relationships" ON gtm_relationships;
CREATE POLICY "Users can view team gtm relationships" ON gtm_relationships FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage own gtm relationships" ON gtm_relationships;
CREATE POLICY "Users can manage own gtm relationships" ON gtm_relationships FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Fix: outreach_drafts and outreach_sequences were never given user_id
-- (only client_id in migration 012). Add it now and backfill from leads.
ALTER TABLE outreach_drafts
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE outreach_drafts od
SET user_id = l.user_id
FROM leads l
WHERE od.lead_id = l.id
  AND od.user_id IS NULL;

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE outreach_sequences os
SET user_id = l.user_id
FROM leads l
WHERE os.lead_id = l.id
  AND os.user_id IS NULL;

-- 12. Update RLS for outreach_drafts and outreach_sequences
DROP POLICY IF EXISTS "Users can manage own outreach drafts" ON outreach_drafts;
CREATE POLICY "Users can view team outreach drafts" ON outreach_drafts FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own outreach drafts" ON outreach_drafts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage outreach drafts" ON outreach_drafts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can manage own outreach sequences" ON outreach_sequences;
CREATE POLICY "Users can view team outreach sequences" ON outreach_sequences FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own outreach sequences" ON outreach_sequences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can manage outreach sequences" ON outreach_sequences FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 13. Update RLS for explore_runs
DROP POLICY IF EXISTS "Users can view own explore runs" ON explore_runs;
CREATE POLICY "Users can view team explore runs" ON explore_runs FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

DROP POLICY IF EXISTS "Users can manage own explore runs" ON explore_runs;
CREATE POLICY "Users can manage own explore runs" ON explore_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 14. Update RLS for watchlist_companies and blocked_companies
DROP POLICY IF EXISTS "Users can manage own watchlist" ON watchlist_companies;
CREATE POLICY "Users can view team watchlist" ON watchlist_companies FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own watchlist" ON watchlist_companies FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own blocked companies" ON blocked_companies;
CREATE POLICY "Users can view team blocked companies" ON blocked_companies FOR SELECT
  USING (
    auth.uid() = user_id
    OR client_id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

CREATE POLICY "Users can manage own blocked companies" ON blocked_companies FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 15. Grant permissions
REVOKE ALL ON FUNCTION get_user_workspace_ids(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_workspace_ids(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_workspace_ids(UUID) TO service_role;

REVOKE ALL ON FUNCTION get_workspace_billing_user_id(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_workspace_billing_user_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_workspace_billing_user_id(UUID) TO service_role;

REVOKE ALL ON FUNCTION is_workspace_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_workspace_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_workspace_member(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION is_workspace_admin_or_owner(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_workspace_admin_or_owner(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION is_workspace_admin_or_owner(UUID, UUID) TO service_role;
