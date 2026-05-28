-- OAuth state for hosted MCP clients.

CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id                TEXT PRIMARY KEY,
  client_name              TEXT,
  redirect_uris            TEXT[] NOT NULL,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash             TEXT PRIMARY KEY,
  client_id             TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri          TEXT NOT NULL,
  code_challenge        TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256',
  scope                 TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  used_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash    TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     TEXT REFERENCES mcp_oauth_clients(client_id) ON DELETE SET NULL,
  scope         TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE mcp_oauth_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage mcp oauth clients"
  ON mcp_oauth_clients FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage mcp oauth codes"
  ON mcp_oauth_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role can manage mcp oauth tokens"
  ON mcp_oauth_tokens FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mcp_oauth_codes_client_expires_idx
  ON mcp_oauth_codes(client_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user_expires_idx
  ON mcp_oauth_tokens(user_id, expires_at DESC);
