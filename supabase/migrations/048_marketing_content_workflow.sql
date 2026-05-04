-- ============================================================
-- 048_marketing_content_workflow.sql
-- Phase 3 marketing/content workflow: durable content ideas,
-- campaign briefs, and campaign assets sourced from GTM signals.
-- ============================================================

CREATE TABLE IF NOT EXISTS gtm_content_ideas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  account_id          UUID REFERENCES gtm_accounts(id) ON DELETE SET NULL,
  lead_id             UUID REFERENCES leads(id) ON DELETE SET NULL,
  idea_key            TEXT NOT NULL,
  source_signal_ids   UUID[] NOT NULL DEFAULT '{}',
  content_type        TEXT NOT NULL CHECK (content_type IN ('linkedin_post', 'newsletter_blurb', 'campaign_brief', 'sales_enablement_note')),
  audience            TEXT NOT NULL,
  angle               TEXT NOT NULL,
  proof_points        JSONB NOT NULL DEFAULT '[]'::jsonb,
  pain_category       TEXT NOT NULL DEFAULT 'market_timing',
  status              TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'drafted', 'approved', 'dismissed')),
  draft               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_ideas_user_client_key_idx
  ON gtm_content_ideas(user_id, client_id, idea_key)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gtm_content_ideas_user_null_client_key_idx
  ON gtm_content_ideas(user_id, idea_key)
  WHERE client_id IS NULL;

CREATE INDEX IF NOT EXISTS gtm_content_ideas_user_status_idx
  ON gtm_content_ideas(user_id, client_id, status, created_at DESC);

ALTER TABLE gtm_content_ideas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gtm content ideas" ON gtm_content_ideas;
CREATE POLICY "Users can manage own gtm content ideas"
  ON gtm_content_ideas FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm content ideas" ON gtm_content_ideas;
CREATE POLICY "Service role can manage gtm content ideas"
  ON gtm_content_ideas FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_content_ideas_updated_at ON gtm_content_ideas;
CREATE TRIGGER gtm_content_ideas_updated_at
  BEFORE UPDATE ON gtm_content_ideas
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  segment             TEXT NOT NULL,
  trigger             TEXT NOT NULL,
  narrative           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'completed', 'dismissed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_campaigns_user_status_idx
  ON gtm_campaigns(user_id, client_id, status, created_at DESC);

ALTER TABLE gtm_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gtm campaigns" ON gtm_campaigns;
CREATE POLICY "Users can manage own gtm campaigns"
  ON gtm_campaigns FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm campaigns" ON gtm_campaigns;
CREATE POLICY "Service role can manage gtm campaigns"
  ON gtm_campaigns FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_campaigns_updated_at ON gtm_campaigns;
CREATE TRIGGER gtm_campaigns_updated_at
  BEFORE UPDATE ON gtm_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS gtm_campaign_assets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         UUID NOT NULL REFERENCES gtm_campaigns(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id           UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  content_idea_id     UUID REFERENCES gtm_content_ideas(id) ON DELETE SET NULL,
  asset_type          TEXT NOT NULL,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,
  channel             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'published', 'dismissed')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gtm_campaign_assets_campaign_idx
  ON gtm_campaign_assets(campaign_id, status, created_at DESC);

ALTER TABLE gtm_campaign_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own gtm campaign assets" ON gtm_campaign_assets;
CREATE POLICY "Users can manage own gtm campaign assets"
  ON gtm_campaign_assets FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage gtm campaign assets" ON gtm_campaign_assets;
CREATE POLICY "Service role can manage gtm campaign assets"
  ON gtm_campaign_assets FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS gtm_campaign_assets_updated_at ON gtm_campaign_assets;
CREATE TRIGGER gtm_campaign_assets_updated_at
  BEFORE UPDATE ON gtm_campaign_assets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
