ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS website_url TEXT;

ALTER TABLE client_accounts
  ADD COLUMN IF NOT EXISTS website_url TEXT;
