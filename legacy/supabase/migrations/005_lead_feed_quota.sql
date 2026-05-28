-- ============================================================
-- 005_lead_feed_quota.sql
-- Enforce monthly lead quotas at feed-delivery time
-- ============================================================

UPDATE user_profiles up
SET
  leads_used_this_month = recent.count_30d,
  leads_reset_at = now()
FROM (
  SELECT user_id, COUNT(*)::int AS count_30d
  FROM leads
  WHERE created_at >= now() - interval '30 days'
  GROUP BY user_id
) recent
WHERE up.user_id = recent.user_id;

UPDATE user_profiles
SET
  leads_used_this_month = 0,
  leads_reset_at = now()
WHERE user_id NOT IN (
  SELECT DISTINCT user_id
  FROM leads
  WHERE created_at >= now() - interval '30 days'
);

CREATE OR REPLACE FUNCTION consume_lead_quota(p_user_id UUID, p_limit INT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_usage INT;
BEGIN
  SELECT COUNT(*)::int
  INTO current_usage
  FROM leads
  WHERE user_id = p_user_id
    AND created_at >= now() - interval '30 days';

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
AS $$
  UPDATE user_profiles
  SET
    leads_used_this_month = (
      SELECT COUNT(*)::int
      FROM leads
      WHERE user_id = p_user_id
        AND created_at >= now() - interval '30 days'
    ),
    leads_reset_at = now()
  WHERE user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION recent_lead_count(p_user_id UUID)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COUNT(*)::int
  FROM leads
  WHERE user_id = p_user_id
    AND created_at >= now() - interval '30 days';
$$;
