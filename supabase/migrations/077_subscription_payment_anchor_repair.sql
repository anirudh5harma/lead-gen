-- ============================================================
-- 077_subscription_payment_anchor_repair.sql
-- Keep subscription usage anchored to payment/webhook dates, not the first day
-- of the calendar month.
-- ============================================================

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
  v_subscription_period TEXT;
  v_subscription_renews_at TIMESTAMPTZ;
  v_leads_used INT;
  v_leads_reset_at TIMESTAMPTZ;
  v_period_end TIMESTAMPTZ;
  v_included_leads INT;
  v_credit_balance INT;
  v_new_balance INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT
    plan,
    subscription_status,
    subscription_period,
    subscription_renews_at,
    leads_used_this_month,
    leads_reset_at,
    lead_credit_balance
  INTO
    v_plan,
    v_subscription_status,
    v_subscription_period,
    v_subscription_renews_at,
    v_leads_used,
    v_leads_reset_at,
    v_credit_balance
  FROM user_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_credit_balance IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_leads_reset_at IS NULL AND v_subscription_status = 'active' THEN
    v_leads_reset_at := v_now;
    UPDATE user_profiles
    SET leads_reset_at = v_leads_reset_at
    WHERE user_id = p_user_id;
  END IF;

  v_included_leads := CASE v_plan
    WHEN 'launch' THEN 100
    WHEN 'team' THEN 350
    WHEN 'growth' THEN 60
    WHEN 'scale' THEN 200
    WHEN 'enterprise' THEN 10000
    ELSE 0
  END;

  v_period_end := COALESCE(
    v_subscription_renews_at,
    v_leads_reset_at + CASE
      WHEN v_subscription_period = 'annual' THEN INTERVAL '1 year'
      ELSE INTERVAL '1 month'
    END
  );

  IF v_subscription_status = 'active'
    AND v_included_leads > 0
    AND v_leads_reset_at IS NOT NULL
    AND v_period_end IS NOT NULL
    AND v_now >= v_leads_reset_at
    AND v_now < v_period_end
    AND COALESCE(v_leads_used, 0) < v_included_leads
  THEN
    UPDATE user_profiles
    SET leads_used_this_month = COALESCE(leads_used_this_month, 0) + 1
    WHERE user_id = p_user_id;

    INSERT INTO subscription_lead_usage(user_id, lead_id, plan, period_start, period_end)
    VALUES (p_user_id, p_lead_id, v_plan, v_leads_reset_at, v_period_end);

    RETURN TRUE;
  END IF;

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

CREATE OR REPLACE FUNCTION get_subscription_tier_config(p_plan TEXT)
RETURNS JSONB AS $$
BEGIN
  RETURN CASE p_plan
    WHEN 'free' THEN '{"name":"Free","monthly_price":0,"annual_price":0,"included_leads":0,"overage_rate":0,"max_inboxes":1,"has_explore":false,"has_auto_send":false}'::jsonb
    WHEN 'launch' THEN '{"name":"Launch","monthly_price":49,"annual_price":490,"included_leads":100,"overage_rate":0,"max_inboxes":3,"has_explore":true,"has_auto_send":true}'::jsonb
    WHEN 'team' THEN '{"name":"Team","monthly_price":149,"annual_price":1490,"included_leads":350,"overage_rate":0,"max_inboxes":10,"has_explore":true,"has_auto_send":true}'::jsonb
    WHEN 'growth' THEN '{"name":"Growth","monthly_price":49,"annual_price":490,"included_leads":60,"overage_rate":0.65,"max_inboxes":3,"has_explore":true,"has_auto_send":true}'::jsonb
    WHEN 'scale' THEN '{"name":"Scale","monthly_price":99,"annual_price":990,"included_leads":200,"overage_rate":0.50,"max_inboxes":10,"has_explore":true,"has_auto_send":true}'::jsonb
    WHEN 'enterprise' THEN '{"name":"Enterprise","monthly_price":0,"annual_price":0,"included_leads":10000,"overage_rate":0,"max_inboxes":999,"has_explore":true,"has_auto_send":true}'::jsonb
    ELSE '{"name":"Free","monthly_price":0,"annual_price":0,"included_leads":0,"overage_rate":0,"max_inboxes":1,"has_explore":false,"has_auto_send":false}'::jsonb
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION reset_monthly_lead_usage()
RETURNS void AS $$
BEGIN
  -- Billing/webhook flows reset usage when payment starts a new period. Keep
  -- this legacy cron target as a no-op so it cannot reset everyone on the 1st.
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION get_subscription_tier_config(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_subscription_tier_config(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_subscription_tier_config(TEXT) TO service_role;

REVOKE ALL ON FUNCTION reset_monthly_lead_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_monthly_lead_usage() TO service_role;
