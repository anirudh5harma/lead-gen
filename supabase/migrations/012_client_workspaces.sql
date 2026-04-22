-- ============================================================
-- 012_client_workspaces.sql
-- Multi-client workspace foundation for solopreneurs/agencies
-- ============================================================

CREATE TABLE IF NOT EXISTS client_accounts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  industry             TEXT,
  target_industries    TEXT[] NOT NULL DEFAULT '{}',
  services_description TEXT NOT NULL DEFAULT '',
  icp_keywords         TEXT[] NOT NULL DEFAULT '{}',
  profile_embedding    vector(1536),
  calendly_url         TEXT,
  target_signal_types  TEXT[] NOT NULL DEFAULT '{"funding","acquisition","expansion","regulation","hiring"}',
  min_relevance_score  INT NOT NULL DEFAULT 6,
  is_archived          BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE client_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own client accounts"
  ON client_accounts FOR ALL
  USING (auth.uid() = user_id);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS active_client_id UUID REFERENCES client_accounts(id) ON DELETE SET NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES client_accounts(id) ON DELETE SET NULL;

ALTER TABLE watchlist_companies
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES client_accounts(id) ON DELETE CASCADE;

ALTER TABLE blocked_companies
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES client_accounts(id) ON DELETE CASCADE;

ALTER TABLE outreach_drafts
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES client_accounts(id) ON DELETE SET NULL;

ALTER TABLE outreach_sequences
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES client_accounts(id) ON DELETE SET NULL;

INSERT INTO client_accounts (
  user_id,
  name,
  industry,
  target_industries,
  services_description,
  icp_keywords,
  profile_embedding,
  calendly_url,
  target_signal_types,
  min_relevance_score,
  created_at,
  updated_at
)
SELECT
  up.user_id,
  up.company_name,
  up.industry,
  up.target_industries,
  up.services_description,
  COALESCE(up.icp_keywords, '{}'),
  up.profile_embedding,
  up.calendly_url,
  COALESCE(up.target_signal_types, '{"funding","acquisition","expansion","regulation","hiring"}'),
  COALESCE(up.min_relevance_score, 6),
  now(),
  now()
FROM user_profiles up
WHERE NOT EXISTS (
  SELECT 1 FROM client_accounts ca WHERE ca.user_id = up.user_id
);

UPDATE user_profiles up
SET active_client_id = ca.id
FROM client_accounts ca
WHERE ca.user_id = up.user_id
  AND up.active_client_id IS NULL;

UPDATE leads l
SET client_id = up.active_client_id
FROM user_profiles up
WHERE l.user_id = up.user_id
  AND l.client_id IS NULL;

UPDATE watchlist_companies w
SET client_id = up.active_client_id
FROM user_profiles up
WHERE w.user_id = up.user_id
  AND w.client_id IS NULL;

UPDATE blocked_companies b
SET client_id = up.active_client_id
FROM user_profiles up
WHERE b.user_id = up.user_id
  AND b.client_id IS NULL;

UPDATE outreach_drafts od
SET client_id = l.client_id
FROM leads l
WHERE od.lead_id = l.id
  AND od.client_id IS NULL;

UPDATE outreach_sequences os
SET client_id = l.client_id
FROM leads l
WHERE os.lead_id = l.id
  AND os.client_id IS NULL;

CREATE TRIGGER client_accounts_updated_at
  BEFORE UPDATE ON client_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS client_accounts_user_id_idx ON client_accounts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_client_id_idx ON leads(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS watchlist_client_id_idx ON watchlist_companies(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS blocked_client_id_idx ON blocked_companies(client_id, created_at DESC);
