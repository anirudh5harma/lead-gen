-- ============================================================
-- 023_monitored_accounts.sql
-- Durable workspace-specific monitored account inventory
-- ============================================================

CREATE TABLE IF NOT EXISTS monitored_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
  company_name          TEXT NOT NULL,
  company_domain        TEXT,
  website_url           TEXT,
  company_key           TEXT NOT NULL,
  seed_sources          TEXT[] NOT NULL DEFAULT '{}',
  is_watchlist          BOOLEAN NOT NULL DEFAULT false,
  priority_score        INT NOT NULL DEFAULT 0,
  last_seeded_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_polled_at        TIMESTAMPTZ,
  last_signal_at        TIMESTAMPTZ,
  last_lead_at          TIMESTAMPTZ,
  last_queue_match_at   TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, company_key)
);

ALTER TABLE monitored_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage monitored accounts"
  ON monitored_accounts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER monitored_accounts_updated_at
  BEFORE UPDATE ON monitored_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX IF NOT EXISTS monitored_accounts_client_priority_idx
  ON monitored_accounts(client_id, is_watchlist DESC, priority_score DESC, last_polled_at ASC NULLS FIRST);

CREATE INDEX IF NOT EXISTS monitored_accounts_recent_seed_idx
  ON monitored_accounts(last_seeded_at DESC, last_signal_at DESC);
