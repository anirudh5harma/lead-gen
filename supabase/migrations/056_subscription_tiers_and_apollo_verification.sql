-- ============================================================
-- 056_subscription_tiers_and_apollo_verification.sql
-- New plan tiers: free, growth, scale, enterprise
-- Subscription-aware lead consumption
-- PAYG credit packs for non-subscribers/overages
-- ============================================================

-- 1. Expand plan enum on user_profiles
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_plan_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_plan_check
  CHECK (plan IN ('free', 'growth', 'scale', 'enterprise'));

-- 2. Add subscription tracking columns to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'none'
    CHECK (subscription_status IN ('none', 'active', 'canceled', 'past_due'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS subscription_external_id TEXT;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS subscription_renews_at TIMESTAMPTZ;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS subscription_period TEXT
    CHECK (subscription_period IN ('monthly', 'annual'));

-- 3. Expand plan enum on subscriptions table
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_plan_check
  CHECK (plan IN ('free', 'growth', 'scale', 'enterprise'));

-- 4. Expand reason enum on lead_credit_transactions
ALTER TABLE lead_credit_transactions
  DROP CONSTRAINT IF EXISTS lead_credit_transactions_reason_check;

ALTER TABLE lead_credit_transactions
  ADD CONSTRAINT lead_credit_transactions_reason_check
  CHECK (reason IN ('starter', 'purchase', 'consume', 'refund', 'admin_adjustment', 'subscription_allocation'));

-- 5. Add lead_usage tracking for subscription leads (separate from PAYG credits)
CREATE TABLE IF NOT EXISTS subscription_lead_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id         UUID REFERENCES leads(id) ON DELETE SET NULL,
  plan            TEXT NOT NULL,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE subscription_lead_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscription lead usage"
  ON subscription_lead_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS subscription_lead_usage_user_period_idx
  ON subscription_lead_usage(user_id, period_start DESC);

-- 6. Update consume_lead_credit to be subscription-aware
-- This RPC now checks subscription included leads FIRST, then PAYG credits
CREATE OR REPLACE FUNCTION consume_lead_credit(
  p_user_id UUID,
  p_lead_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'consume',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN AS $$
DECLARE
  v_plan TEXT;
  v_subscription_status TEXT;
  v_leads_used INT;
  v_leads_reset_at TIMESTAMPTZ;
  v_included_leads INT;
  v_credit_balance INT;
  v_new_balance INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Get user subscription state
  SELECT plan, subscription_status, leads_used_this_month, leads_reset_at, lead_credit_balance
  INTO v_plan, v_subscription_status, v_leads_used, v_leads_reset_at, v_credit_balance
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_credit_balance IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Reset monthly counter if needed
  IF v_leads_reset_at IS NULL OR v_leads_reset_at < date_trunc('month', v_now) THEN
    v_leads_used := 0;
    v_leads_reset_at := date_trunc('month', v_now);
    UPDATE user_profiles
    SET leads_used_this_month = 0, leads_reset_at = v_leads_reset_at
    WHERE user_id = p_user_id;
  END IF;

  -- Determine included leads based on plan
  v_included_leads := CASE v_plan
    WHEN 'growth' THEN 60
    WHEN 'scale' THEN 200
    WHEN 'enterprise' THEN 10000  -- effectively unlimited
    ELSE 0
  END;

  -- Strategy 1: Active subscription with included leads remaining
  IF v_subscription_status = 'active' AND v_leads_used < v_included_leads THEN
    UPDATE user_profiles
    SET leads_used_this_month = leads_used_this_month + 1
    WHERE user_id = p_user_id;

    INSERT INTO subscription_lead_usage(user_id, lead_id, plan, period_start, period_end)
    VALUES (p_user_id, p_lead_id, v_plan, v_leads_reset_at, v_leads_reset_at + INTERVAL '1 month');

    RETURN TRUE;
  END IF;

  -- Strategy 2: PAYG credits (free users, overages, or expired subscriptions)
  IF v_credit_balance <= 0 THEN
    RETURN FALSE;
  END IF;

  v_new_balance := v_credit_balance - 1;

  UPDATE user_profiles
  SET lead_credit_balance = v_new_balance
  WHERE user_id = p_user_id;

  INSERT INTO lead_credit_transactions(user_id, lead_id, delta, balance_after, reason, metadata)
  VALUES (p_user_id, p_lead_id, -1, v_new_balance, p_reason, COALESCE(p_metadata, '{}'::jsonb));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. Function to get subscription tier config
CREATE OR REPLACE FUNCTION get_subscription_tier_config(p_plan TEXT)
RETURNS JSONB AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'free' THEN '{"name":"Launch","monthly_price":0,"annual_price":0,"included_leads":0,"overage_rate":0,"max_inboxes":1,"has_explore":false,"has_auto_send":false}'::jsonb
    WHEN 'growth' THEN '{"name":"Growth","monthly_price":49,"annual_price":490,"included_leads":60,"overage_rate":0.65,"max_inboxes":3,"has_explore":true,"has_auto_send":true}'::jsonb
    WHEN 'scale' THEN '{"name":"Scale","monthly_price":99,"annual_price":990,"included_leads":200,"overage_rate":0.50,"max_inboxes":10,"has_explore":true,"has_auto_send":true}'::jsonb
    WHEN 'enterprise' THEN '{"name":"Enterprise","monthly_price":0,"annual_price":0,"included_leads":10000,"overage_rate":0,"max_inboxes":999,"has_explore":true,"has_auto_send":true}'::jsonb
    ELSE '{"name":"Launch","monthly_price":0,"annual_price":0,"included_leads":0,"overage_rate":0,"max_inboxes":1,"has_explore":false,"has_auto_send":false}'::jsonb
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public;

-- 8. Function to reset monthly lead usage (can be called by cron)
CREATE OR REPLACE FUNCTION reset_monthly_lead_usage()
RETURNS void AS $$
BEGIN
  UPDATE user_profiles
  SET leads_used_this_month = 0,
      leads_reset_at = date_trunc('month', now())
  WHERE leads_reset_at < date_trunc('month', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. Grant permissions
REVOKE ALL ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION get_subscription_tier_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_subscription_tier_config(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_subscription_tier_config(TEXT) TO service_role;

REVOKE ALL ON FUNCTION reset_monthly_lead_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_monthly_lead_usage() TO service_role;

-- 10. Migrate existing free users
UPDATE user_profiles
SET plan = 'free',
    subscription_status = 'none',
    subscription_period = NULL,
    subscription_external_id = NULL,
    subscription_renews_at = NULL
WHERE plan = 'free' OR plan IS NULL;

UPDATE subscriptions
SET plan = 'free',
    status = 'active'
WHERE plan NOT IN ('free', 'growth', 'scale', 'enterprise') OR plan IS NULL;
