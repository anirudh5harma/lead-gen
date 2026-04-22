-- ============================================================
-- 014_sequences_and_crm.sql
-- Reusable sequence templates and generic CRM webhook sync
-- ============================================================

CREATE TABLE IF NOT EXISTS sequence_templates (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id                    UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  name                         TEXT NOT NULL,
  custom_instructions          TEXT,
  followup_custom_instructions TEXT,
  is_default                   BOOLEAN NOT NULL DEFAULT false,
  created_at                   TIMESTAMPTZ DEFAULT now(),
  updated_at                   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sequence_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sequence templates"
  ON sequence_templates FOR ALL
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS crm_sync_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id    UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'webhook',
  webhook_url  TEXT,
  enabled      BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, client_id)
);

ALTER TABLE crm_sync_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own CRM sync settings"
  ON crm_sync_settings FOR ALL
  USING (auth.uid() = user_id);

CREATE TRIGGER sequence_templates_updated_at
  BEFORE UPDATE ON sequence_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER crm_sync_settings_updated_at
  BEFORE UPDATE ON crm_sync_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS sequence_templates_user_client_idx ON sequence_templates(user_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_sync_settings_user_client_idx ON crm_sync_settings(user_id, client_id);
