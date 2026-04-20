-- Columns for Gmail push notification watch and Outlook Graph subscription tracking
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS gmail_history_id          TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_id   TEXT,
  ADD COLUMN IF NOT EXISTS outlook_subscription_exp  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outlook_client_state      TEXT;
