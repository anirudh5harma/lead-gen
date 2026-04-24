-- ============================================================
-- 028_function_execute_hardening.sql
-- Restrict RPC execute rights and harden security definer helpers
-- ============================================================

-- Ensure quota helpers use a fixed search_path under SECURITY DEFINER.
CREATE OR REPLACE FUNCTION consume_lead_quota(p_user_id UUID, p_limit INT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_usage INT;
BEGIN
  SELECT COUNT(*)::int
  INTO current_usage
  FROM leads
  WHERE user_id = p_user_id
    AND is_unlocked = true
    AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days';

  IF current_usage >= p_limit THEN
    UPDATE user_profiles
    SET
      leads_used_this_month = current_usage,
      leads_reset_at = now()
    WHERE user_id = p_user_id;

    RETURN false;
  END IF;

  UPDATE user_profiles
  SET
    leads_used_this_month = current_usage + 1,
    leads_reset_at = now()
  WHERE user_id = p_user_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION refund_lead_quota(p_user_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE user_profiles
  SET
    leads_used_this_month = (
      SELECT COUNT(*)::int
      FROM leads
      WHERE user_id = p_user_id
        AND is_unlocked = true
        AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days'
    ),
    leads_reset_at = now()
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION recent_lead_count(p_user_id UUID)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM leads
  WHERE user_id = p_user_id
    AND is_unlocked = true
    AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days';
$$;

CREATE OR REPLACE FUNCTION increment_leads_used(p_user_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE user_profiles
  SET leads_used_this_month = leads_used_this_month + 1
  WHERE user_id = p_user_id;
$$;

-- Narrow function execute rights to the roles that actually use each RPC.
REVOKE ALL ON FUNCTION consume_lead_quota(UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_lead_quota(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION consume_lead_quota(UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION refund_lead_quota(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_lead_quota(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_lead_quota(UUID) TO service_role;

REVOKE ALL ON FUNCTION recent_lead_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recent_lead_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION recent_lead_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION increment_leads_used(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_leads_used(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION increment_leads_used(UUID) TO service_role;

REVOKE ALL ON FUNCTION match_candidate_signals(VECTOR, TEXT[], TIMESTAMPTZ, INT, FLOAT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION match_candidate_signals(VECTOR, TEXT[], TIMESTAMPTZ, INT, FLOAT) TO service_role;

REVOKE ALL ON FUNCTION rate_limit_check(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, INT, INT) TO service_role;
