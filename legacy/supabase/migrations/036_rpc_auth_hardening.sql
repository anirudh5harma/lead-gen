-- Lock security-definer RPCs to the authenticated user's own ID unless called by service_role.

CREATE OR REPLACE FUNCTION consume_lead_quota(p_user_id UUID, p_limit INT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_usage INT;
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

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
END;
$$;

CREATE OR REPLACE FUNCTION recent_lead_count(p_user_id UUID)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN (
    SELECT COUNT(*)::int
    FROM leads
    WHERE user_id = p_user_id
      AND is_unlocked = true
      AND COALESCE(unlocked_at, created_at) >= now() - interval '30 days'
  );
END;
$$;

CREATE OR REPLACE FUNCTION increment_leads_used(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE user_profiles
  SET leads_used_this_month = leads_used_this_month + 1
  WHERE user_id = p_user_id;
END;
$$;

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
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

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
  IF auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

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

CREATE OR REPLACE FUNCTION rate_limit_check(
  p_key         TEXT,
  p_max         INT,
  p_window_secs INT
) RETURNS TABLE (allowed BOOLEAN, current_count INT) AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INT;
BEGIN
  IF auth.role() <> 'service_role' AND POSITION(auth.uid()::text IN p_key) = 0 THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT rl.window_start, rl.count
    INTO v_window_start, v_count
    FROM rate_limit_windows rl
   WHERE rl.key = p_key
     FOR UPDATE;

  IF NOT FOUND OR now() - v_window_start > (p_window_secs || ' seconds')::INTERVAL THEN
    INSERT INTO rate_limit_windows(key, count, window_start)
    VALUES (p_key, 1, now())
    ON CONFLICT (key) DO UPDATE
      SET count = 1, window_start = now();
    RETURN QUERY SELECT TRUE, 1;
    RETURN;
  END IF;

  UPDATE rate_limit_windows
     SET count = count + 1
   WHERE key = p_key;

  IF v_count + 1 > p_max THEN
    RETURN QUERY SELECT FALSE, v_count + 1;
  ELSE
    RETURN QUERY SELECT TRUE, v_count + 1;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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

REVOKE ALL ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION consume_lead_credit(UUID, UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION refund_lead_credit(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_lead_credit(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION refund_lead_credit(UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION rate_limit_check(TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION rate_limit_check(TEXT, INT, INT) TO service_role;

UPDATE leads
SET match_debug = match_debug - 'import_key' - 'raw'
WHERE origin = 'crm_import'
  AND match_debug IS NOT NULL
  AND (match_debug ? 'import_key' OR match_debug ? 'raw');
