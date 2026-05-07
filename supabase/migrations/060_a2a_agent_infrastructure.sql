-- ============================================================
-- 060_a2a_agent_infrastructure.sql
-- A2A (Agent-to-Agent) infrastructure for Bombsell
-- Agent identities, API keys, webhook subscriptions, agent wallets
-- ============================================================

-- 1. Agent identity registry
CREATE TABLE IF NOT EXISTS agent_identities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id       UUID REFERENCES client_accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  provider        TEXT NOT NULL,           -- e.g. 'crewai', 'autogen', 'custom'
  principal_email TEXT NOT NULL,           -- human owner
  metadata        JSONB DEFAULT '{}'::jsonb,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_identities_user_id_idx ON agent_identities(user_id);
CREATE INDEX IF NOT EXISTS agent_identities_client_id_idx ON agent_identities(client_id);

ALTER TABLE agent_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent identities"
  ON agent_identities FOR ALL
  USING (auth.uid() = user_id);

-- 2. Agent API keys (scoped, revocable)
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash        TEXT NOT NULL,           -- bcrypt hash of the visible key
  key_prefix      TEXT NOT NULL,           -- first 8 chars for display
  name            TEXT NOT NULL DEFAULT 'Default',
  scopes          TEXT[] NOT NULL DEFAULT ARRAY['read:signals', 'read:accounts'],
  rate_limit_tier TEXT NOT NULL DEFAULT 'growth', -- launch|growth|scale|enterprise
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_api_keys_agent_id_idx ON agent_api_keys(agent_id);
CREATE INDEX IF NOT EXISTS agent_api_keys_user_id_idx ON agent_api_keys(user_id);
CREATE INDEX IF NOT EXISTS agent_api_keys_key_prefix_idx ON agent_api_keys(key_prefix);

ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own agent API keys"
  ON agent_api_keys FOR ALL
  USING (auth.uid() = user_id);

-- 3. Agent webhook subscriptions (signal streaming)
CREATE TABLE IF NOT EXISTS agent_webhook_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  secret          TEXT NOT NULL,           -- for HMAC verification
  event_types     TEXT[] NOT NULL DEFAULT ARRAY['signal.new', 'account.reasoned', 'outreach.sent'],
  icp_filter      JSONB DEFAULT '{}'::jsonb,  -- filter by ICP criteria
  min_score       NUMERIC DEFAULT 7,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_delivered_at TIMESTAMPTZ,
  last_error_at   TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_webhook_subscriptions_agent_id_idx ON agent_webhook_subscriptions(agent_id);
CREATE INDEX IF NOT EXISTS agent_webhook_subscriptions_user_id_idx ON agent_webhook_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS agent_webhook_subscriptions_active_idx ON agent_webhook_subscriptions(is_active) WHERE is_active = true;

ALTER TABLE agent_webhook_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own webhook subscriptions"
  ON agent_webhook_subscriptions FOR ALL
  USING (auth.uid() = user_id);

-- 4. Agent credit wallets (separate from human PAYG for granular tracking)
CREATE TABLE IF NOT EXISTS agent_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance         NUMERIC NOT NULL DEFAULT 0,  -- in credits, can be negative (postpaid)
  auto_top_up     BOOLEAN NOT NULL DEFAULT false,
  auto_top_up_threshold NUMERIC DEFAULT 10,
  auto_top_up_amount    NUMERIC DEFAULT 50,
  total_consumed  NUMERIC NOT NULL DEFAULT 0,
  total_earned    NUMERIC NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agent_id)
);

ALTER TABLE agent_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agent wallets"
  ON agent_wallets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage agent wallets"
  ON agent_wallets FOR ALL
  TO service_role
  USING (true);

-- 5. Agent transaction ledger (every API call is a transaction)
CREATE TABLE IF NOT EXISTS agent_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  api_key_id      UUID REFERENCES agent_api_keys(id) ON DELETE SET NULL,
  tool            TEXT NOT NULL,           -- e.g. 'bombsell.watch_market', 'bombsell.reason_account'
  action          TEXT NOT NULL,           -- e.g. 'signal_delivered', 'account_reasoned', 'outreach_sent'
  cost            NUMERIC NOT NULL DEFAULT 0,
  balance_after   NUMERIC NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
  request_payload JSONB DEFAULT '{}'::jsonb,
  response_payload JSONB DEFAULT '{}'::jsonb,
  audit_hash      TEXT,                    -- SHA-256 of the attestation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_transactions_agent_id_idx ON agent_transactions(agent_id);
CREATE INDEX IF NOT EXISTS agent_transactions_created_at_idx ON agent_transactions(created_at DESC);

ALTER TABLE agent_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own agent transactions"
  ON agent_transactions FOR SELECT
  USING (auth.uid() = (SELECT user_id FROM agent_identities WHERE id = agent_transactions.agent_id));

-- 6. Guardrail attestations (verifiable proofs for agents)
CREATE TABLE IF NOT EXISTS agent_attestations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES agent_transactions(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
  attestation_type TEXT NOT NULL,          -- 'contact_verified', 'unsubscribe_checked', 'bounce_safe', 'timing_appropriate'
  passed          BOOLEAN NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature       TEXT,                    -- HMAC-SHA256 of attestation blob
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_attestations_transaction_id_idx ON agent_attestations(transaction_id);

ALTER TABLE agent_attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attestations"
  ON agent_attestations FOR SELECT
  USING (auth.uid() = (SELECT user_id FROM agent_identities WHERE id = agent_attestations.agent_id));

-- 7. Webhook delivery log
CREATE TABLE IF NOT EXISTS agent_webhook_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES agent_webhook_subscriptions(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  response_status INTEGER,
  response_body   TEXT,
  delivery_duration_ms INTEGER,
  success         BOOLEAN NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_webhook_deliveries_subscription_id_idx ON agent_webhook_deliveries(subscription_id);
CREATE INDEX IF NOT EXISTS agent_webhook_deliveries_created_at_idx ON agent_webhook_deliveries(created_at DESC);

ALTER TABLE agent_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own webhook deliveries"
  ON agent_webhook_deliveries FOR SELECT
  USING (auth.uid() = (SELECT user_id FROM agent_webhook_subscriptions WHERE id = agent_webhook_deliveries.subscription_id));

-- 8. Agent tier rate limits (config)
CREATE TABLE IF NOT EXISTS agent_rate_limit_tiers (
  tier            TEXT PRIMARY KEY,
  requests_per_minute INTEGER NOT NULL DEFAULT 60,
  requests_per_hour   INTEGER NOT NULL DEFAULT 1000,
  requests_per_day    INTEGER NOT NULL DEFAULT 10000,
  concurrent_requests INTEGER NOT NULL DEFAULT 5,
  max_webhooks        INTEGER NOT NULL DEFAULT 3,
  max_agents          INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO agent_rate_limit_tiers (tier, requests_per_minute, requests_per_hour, requests_per_day, concurrent_requests, max_webhooks, max_agents)
VALUES
  ('launch',    10,  100,   1000,  2, 1, 1),
  ('growth',    60,  1000,  10000, 5, 3, 3),
  ('scale',     300, 5000,  50000, 10, 10, 10),
  ('enterprise', 0,  0,     0,     50, 50, 50)  -- 0 = unlimited
ON CONFLICT (tier) DO UPDATE SET
  requests_per_minute = EXCLUDED.requests_per_minute,
  requests_per_hour = EXCLUDED.requests_per_hour,
  requests_per_day = EXCLUDED.requests_per_day,
  concurrent_requests = EXCLUDED.concurrent_requests,
  max_webhooks = EXCLUDED.max_webhooks,
  max_agents = EXCLUDED.max_agents;

-- 9. Cost catalog (per-action pricing)
CREATE TABLE IF NOT EXISTS agent_cost_catalog (
  action          TEXT PRIMARY KEY,
  credit_cost     NUMERIC NOT NULL DEFAULT 0,
  description     TEXT NOT NULL,
  unit            TEXT NOT NULL DEFAULT 'call'  -- 'call', 'signal', 'contact', 'send'
);

INSERT INTO agent_cost_catalog (action, credit_cost, description, unit)
VALUES
  ('signal_delivered',     0.05, 'Deliver a market signal to agent webhook', 'signal'),
  ('account_reasoned',     0.25, 'Run account fit/urgency/timing reasoning', 'call'),
  ('contact_enriched',     0.50, 'Find and verify a contact for an account', 'contact'),
  ('outreach_executed',    1.00, 'Send safe outreach with full guardrails', 'send'),
  ('avatar_video_rendered', 5.00, 'Generate an avatar video from script', 'render'),
  ('explore_searched',     0.10, 'Run AI-powered lead discovery search', 'call')
ON CONFLICT (action) DO UPDATE SET
  credit_cost = EXCLUDED.credit_cost,
  description = EXCLUDED.description,
  unit = EXCLUDED.unit;

-- 10. Functions

-- Create agent wallet on identity creation
CREATE OR REPLACE FUNCTION create_agent_wallet()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO agent_wallets (agent_id, user_id, balance)
  VALUES (NEW.id, NEW.user_id, 0)
  ON CONFLICT (agent_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS agent_identity_wallet ON agent_identities;
CREATE TRIGGER agent_identity_wallet
  AFTER INSERT ON agent_identities
  FOR EACH ROW
  EXECUTE FUNCTION create_agent_wallet();

-- Consume agent credits atomically
CREATE OR REPLACE FUNCTION consume_agent_credit(
  p_agent_id UUID,
  p_amount NUMERIC,
  p_tool TEXT,
  p_action TEXT,
  p_request_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE(transaction_id UUID, balance_after NUMERIC, success BOOLEAN) AS $$
DECLARE
  v_user_id UUID;
  v_balance NUMERIC;
  v_tx_id UUID;
BEGIN
  SELECT user_id, balance INTO v_user_id, v_balance
  FROM agent_wallets
  WHERE agent_id = p_agent_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, NULL::NUMERIC, false;
    RETURN;
  END IF;

  IF v_balance < p_amount THEN
    RETURN QUERY SELECT NULL::UUID, v_balance, false;
    RETURN;
  END IF;

  INSERT INTO agent_transactions (agent_id, tool, action, cost, balance_after, status, request_payload)
  VALUES (p_agent_id, p_tool, p_action, p_amount, v_balance - p_amount, 'pending', p_request_payload)
  RETURNING id INTO v_tx_id;

  UPDATE agent_wallets
  SET balance = balance - p_amount,
      total_consumed = total_consumed + p_amount,
      updated_at = now()
  WHERE agent_id = p_agent_id;

  RETURN QUERY SELECT v_tx_id, v_balance - p_amount, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Complete or fail a transaction
CREATE OR REPLACE FUNCTION finalize_agent_transaction(
  p_transaction_id UUID,
  p_status TEXT,
  p_response_payload JSONB DEFAULT '{}'::jsonb,
  p_audit_hash TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_agent_id UUID;
  v_cost NUMERIC;
BEGIN
  SELECT agent_id, cost INTO v_agent_id, v_cost
  FROM agent_transactions
  WHERE id = p_transaction_id;

  IF v_agent_id IS NULL THEN RETURN; END IF;

  UPDATE agent_transactions
  SET status = p_status,
      response_payload = p_response_payload,
      audit_hash = p_audit_hash,
      updated_at = now()
  WHERE id = p_transaction_id;

  -- Refund on failure
  IF p_status = 'failed' OR p_status = 'refunded' THEN
    UPDATE agent_wallets
    SET balance = balance + v_cost,
        total_consumed = total_consumed - v_cost,
        updated_at = now()
    WHERE agent_id = v_agent_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant agent credits (from human wallet or purchase)
CREATE OR REPLACE FUNCTION grant_agent_credits(
  p_agent_id UUID,
  p_amount NUMERIC,
  p_source TEXT DEFAULT 'purchase'
)
RETURNS NUMERIC AS $$
DECLARE
  v_new_balance NUMERIC;
BEGIN
  UPDATE agent_wallets
  SET balance = balance + p_amount,
      total_earned = total_earned + p_amount,
      updated_at = now()
  WHERE agent_id = p_agent_id
  RETURNING balance INTO v_new_balance;

  RETURN v_new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 11. Permissions
GRANT ALL ON agent_identities TO authenticated, service_role;
GRANT ALL ON agent_api_keys TO authenticated, service_role;
GRANT ALL ON agent_webhook_subscriptions TO authenticated, service_role;
GRANT ALL ON agent_wallets TO authenticated, service_role;
GRANT ALL ON agent_transactions TO authenticated, service_role;
GRANT ALL ON agent_attestations TO authenticated, service_role;
GRANT ALL ON agent_webhook_deliveries TO authenticated, service_role;
GRANT ALL ON agent_rate_limit_tiers TO authenticated, service_role;
GRANT ALL ON agent_cost_catalog TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION consume_agent_credit(UUID, NUMERIC, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION finalize_agent_transaction(UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION grant_agent_credits(UUID, NUMERIC, TEXT) TO authenticated, service_role;
