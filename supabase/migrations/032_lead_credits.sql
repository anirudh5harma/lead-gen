-- ============================================================
-- 032_lead_credits.sql
-- Prepaid lead-credit balance and ledger
-- ============================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS lead_credit_balance INT NOT NULL DEFAULT 0
    CHECK (lead_credit_balance >= 0);

CREATE TABLE IF NOT EXISTS lead_credit_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id       UUID REFERENCES leads(id) ON DELETE SET NULL,
  delta         INT NOT NULL CHECK (delta <> 0),
  balance_after INT NOT NULL CHECK (balance_after >= 0),
  reason        TEXT NOT NULL CHECK (reason IN ('purchase', 'consume', 'refund', 'admin_adjustment')),
  external_id   TEXT UNIQUE,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE lead_credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own lead credit transactions" ON lead_credit_transactions;
CREATE POLICY "Users can view own lead credit transactions"
  ON lead_credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS lead_credit_transactions_user_created_idx
  ON lead_credit_transactions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION add_lead_credits(
  p_user_id UUID,
  p_credits INT,
  p_external_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT 'purchase',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INT AS $$
DECLARE
  current_balance INT;
  new_balance INT;
  existing_balance INT;
BEGIN
  IF p_credits <= 0 THEN
    RAISE EXCEPTION 'p_credits must be positive';
  END IF;

  IF p_external_id IS NOT NULL THEN
    SELECT balance_after INTO existing_balance
    FROM lead_credit_transactions
    WHERE external_id = p_external_id;

    IF existing_balance IS NOT NULL THEN
      RETURN existing_balance;
    END IF;
  END IF;

  SELECT lead_credit_balance INTO current_balance
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'user profile not found';
  END IF;

  new_balance := current_balance + p_credits;

  UPDATE user_profiles
  SET lead_credit_balance = new_balance
  WHERE user_id = p_user_id;

  INSERT INTO lead_credit_transactions(user_id, delta, balance_after, reason, external_id, metadata)
  VALUES (p_user_id, p_credits, new_balance, p_reason, p_external_id, COALESCE(p_metadata, '{}'::jsonb));

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION consume_lead_credit(
  p_user_id UUID,
  p_lead_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'consume',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN AS $$
DECLARE
  current_balance INT;
  new_balance INT;
BEGIN
  SELECT lead_credit_balance INTO current_balance
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF current_balance IS NULL OR current_balance <= 0 THEN
    RETURN FALSE;
  END IF;

  new_balance := current_balance - 1;

  UPDATE user_profiles
  SET lead_credit_balance = new_balance
  WHERE user_id = p_user_id;

  INSERT INTO lead_credit_transactions(user_id, lead_id, delta, balance_after, reason, metadata)
  VALUES (p_user_id, p_lead_id, -1, new_balance, p_reason, COALESCE(p_metadata, '{}'::jsonb));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION refund_lead_credit(
  p_user_id UUID,
  p_lead_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS INT AS $$
DECLARE
  current_balance INT;
  new_balance INT;
BEGIN
  SELECT lead_credit_balance INTO current_balance
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF current_balance IS NULL THEN
    RAISE EXCEPTION 'user profile not found';
  END IF;

  new_balance := current_balance + 1;

  UPDATE user_profiles
  SET lead_credit_balance = new_balance
  WHERE user_id = p_user_id;

  INSERT INTO lead_credit_transactions(user_id, lead_id, delta, balance_after, reason, metadata)
  VALUES (p_user_id, p_lead_id, 1, new_balance, 'refund', COALESCE(p_metadata, '{}'::jsonb));

  RETURN new_balance;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION add_lead_credits(UUID, INT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION add_lead_credits(UUID, INT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION refund_lead_credit(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_lead_credit(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_lead_credit(UUID, UUID, JSONB) TO service_role;
