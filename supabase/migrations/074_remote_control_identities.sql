-- Remote control identities let Telegram and Discord users control the
-- dashboard after the platform webhook itself has been verified.

CREATE TABLE IF NOT EXISTS remote_control_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'discord')),
  provider_user_id TEXT NOT NULL,
  provider_chat_id TEXT,
  username TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS remote_control_identities_user_idx
  ON remote_control_identities(user_id);

CREATE INDEX IF NOT EXISTS remote_control_identities_provider_enabled_idx
  ON remote_control_identities(provider, provider_user_id)
  WHERE enabled = TRUE;

ALTER TABLE remote_control_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own remote control identities"
  ON remote_control_identities FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON remote_control_identities TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS remote_control_link_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('telegram', 'discord')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS remote_control_link_tokens_user_idx
  ON remote_control_link_tokens(user_id);

CREATE INDEX IF NOT EXISTS remote_control_link_tokens_lookup_idx
  ON remote_control_link_tokens(provider, token_hash)
  WHERE consumed_at IS NULL;

ALTER TABLE remote_control_link_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own remote control link tokens"
  ON remote_control_link_tokens FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON remote_control_link_tokens TO authenticated, service_role;
