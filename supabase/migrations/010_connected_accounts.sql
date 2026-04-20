-- Store OAuth-connected sending accounts (Gmail / Outlook) per user.
-- Emails are sent directly from the user's own inbox — no shared domain.
CREATE TABLE IF NOT EXISTS connected_accounts (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider         TEXT        NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  email            TEXT        NOT NULL,
  display_name     TEXT,
  access_token     TEXT        NOT NULL,
  refresh_token    TEXT        NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  last_used_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, email)
);

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own connected accounts"
  ON connected_accounts FOR ALL
  USING (auth.uid() = user_id);

-- Track which sending account was used per lead (for follow-up continuity + threading)
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS from_email     TEXT,
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;
