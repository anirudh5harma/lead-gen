-- ============================================================
-- 062_plan_a2a_team_hardening.sql
-- Hardening for Scale team access and A2A agent infrastructure.
-- ============================================================

-- Team members need to read workspace metadata for active workspace context.
DROP POLICY IF EXISTS "Users can view team client accounts" ON client_accounts;
CREATE POLICY "Users can view team client accounts"
  ON client_accounts FOR SELECT
  USING (
    auth.uid() = user_id
    OR id IN (SELECT get_user_workspace_ids(auth.uid()))
  );

-- Agent API key lookup must be unique and indexed by hash, not just display prefix.
CREATE UNIQUE INDEX IF NOT EXISTS agent_api_keys_key_hash_idx
  ON agent_api_keys(key_hash);

ALTER TABLE agent_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Allow the ledger to represent explicit transfers to agent wallets.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lead_credit_transactions_reason_check'
  ) THEN
    ALTER TABLE lead_credit_transactions
      DROP CONSTRAINT lead_credit_transactions_reason_check;
  END IF;
END $$;

ALTER TABLE lead_credit_transactions
  ADD CONSTRAINT lead_credit_transactions_reason_check
  CHECK (reason IN (
    'starter',
    'purchase',
    'consume',
    'refund',
    'admin_adjustment',
    'subscription_allocation',
    'agent_transfer'
  ));

-- Complete/refund transactions idempotently. The previous function could refund
-- more than once if a failed/refunded transaction was finalized repeatedly.
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
  v_status TEXT;
BEGIN
  SELECT agent_id, cost, status INTO v_agent_id, v_cost, v_status
  FROM agent_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF v_agent_id IS NULL OR v_status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE agent_transactions
  SET status = p_status,
      response_payload = p_response_payload,
      audit_hash = p_audit_hash,
      updated_at = now()
  WHERE id = p_transaction_id;

  IF p_status = 'failed' OR p_status = 'refunded' THEN
    UPDATE agent_wallets
    SET balance = balance + v_cost,
        total_consumed = GREATEST(0, total_consumed - v_cost),
        updated_at = now()
    WHERE agent_id = v_agent_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic transfer from a human lead-credit wallet into an agent wallet.
CREATE OR REPLACE FUNCTION transfer_lead_credits_to_agent(
  p_user_id UUID,
  p_agent_id UUID,
  p_amount INT
)
RETURNS TABLE(human_balance_after INT, agent_balance_after NUMERIC, success BOOLEAN) AS $$
DECLARE
  v_human_balance INT;
  v_human_balance_after INT;
  v_agent_balance_after NUMERIC;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'p_amount must be positive';
  END IF;

  PERFORM 1
  FROM agent_identities
  WHERE id = p_agent_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::INT, NULL::NUMERIC, false;
    RETURN;
  END IF;

  SELECT lead_credit_balance INTO v_human_balance
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_human_balance IS NULL OR v_human_balance < p_amount THEN
    RETURN QUERY SELECT v_human_balance, NULL::NUMERIC, false;
    RETURN;
  END IF;

  v_human_balance_after := v_human_balance - p_amount;

  UPDATE user_profiles
  SET lead_credit_balance = v_human_balance_after
  WHERE user_id = p_user_id;

  UPDATE agent_wallets
  SET balance = balance + p_amount,
      total_earned = total_earned + p_amount,
      updated_at = now()
  WHERE agent_id = p_agent_id
  RETURNING balance INTO v_agent_balance_after;

  INSERT INTO lead_credit_transactions(user_id, delta, balance_after, reason, metadata)
  VALUES (
    p_user_id,
    -p_amount,
    v_human_balance_after,
    'agent_transfer',
    jsonb_build_object('agent_id', p_agent_id, 'amount', p_amount)
  );

  RETURN QUERY SELECT v_human_balance_after, v_agent_balance_after, true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION transfer_lead_credits_to_agent(UUID, UUID, INT) TO authenticated, service_role;
