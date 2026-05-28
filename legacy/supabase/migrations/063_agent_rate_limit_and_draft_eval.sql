-- ============================================================
-- 063_agent_rate_limit_and_draft_eval.sql
-- Distributed A2A rate limiting + outreach draft quality telemetry
-- ============================================================

-- 1) Distributed rate-limit counters (multi-instance safe)
CREATE TABLE IF NOT EXISTS agent_rate_limit_counters (
  api_key_id    UUID NOT NULL REFERENCES agent_api_keys(id) ON DELETE CASCADE,
  bucket_window TEXT NOT NULL CHECK (bucket_window IN ('minute', 'hour', 'day')),
  bucket_start  TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (api_key_id, bucket_window, bucket_start)
);

CREATE INDEX IF NOT EXISTS agent_rate_limit_counters_bucket_idx
  ON agent_rate_limit_counters(bucket_start DESC);

ALTER TABLE agent_rate_limit_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage agent rate limit counters"
  ON agent_rate_limit_counters FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION check_and_increment_agent_rate_limit(
  p_api_key_id UUID,
  p_tier TEXT
)
RETURNS TABLE(allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMPTZ, rate_window TEXT) AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_minute_bucket TIMESTAMPTZ;
  v_hour_bucket TIMESTAMPTZ;
  v_day_bucket TIMESTAMPTZ;
  v_minute_limit INTEGER := 60;
  v_hour_limit INTEGER := 1000;
  v_day_limit INTEGER := 10000;
  v_minute_count INTEGER := 0;
  v_hour_count INTEGER := 0;
  v_day_count INTEGER := 0;
  v_remaining INTEGER := 2147483647;
BEGIN
  SELECT
    requests_per_minute,
    requests_per_hour,
    requests_per_day
  INTO
    v_minute_limit,
    v_hour_limit,
    v_day_limit
  FROM agent_rate_limit_tiers
  WHERE tier = p_tier;

  v_minute_limit := COALESCE(v_minute_limit, 60);
  v_hour_limit := COALESCE(v_hour_limit, 1000);
  v_day_limit := COALESCE(v_day_limit, 10000);

  v_minute_bucket := date_trunc('minute', v_now);
  v_hour_bucket := date_trunc('hour', v_now);
  v_day_bucket := date_trunc('day', v_now);

  -- Keep one-key cleanup bounded to this API key.
  DELETE FROM agent_rate_limit_counters
  WHERE api_key_id = p_api_key_id
    AND bucket_start < (v_now - interval '2 days');

  IF v_minute_limit > 0 THEN
    INSERT INTO agent_rate_limit_counters (api_key_id, bucket_window, bucket_start, request_count, updated_at)
    VALUES (p_api_key_id, 'minute', v_minute_bucket, 1, v_now)
    ON CONFLICT (api_key_id, bucket_window, bucket_start)
    DO UPDATE SET
      request_count = agent_rate_limit_counters.request_count + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING request_count INTO v_minute_count;

    IF v_minute_count > v_minute_limit THEN
      RETURN QUERY SELECT false, 0, v_minute_bucket + interval '1 minute', 'minute';
      RETURN;
    END IF;
    v_remaining := LEAST(v_remaining, v_minute_limit - v_minute_count);
  END IF;

  IF v_hour_limit > 0 THEN
    INSERT INTO agent_rate_limit_counters (api_key_id, bucket_window, bucket_start, request_count, updated_at)
    VALUES (p_api_key_id, 'hour', v_hour_bucket, 1, v_now)
    ON CONFLICT (api_key_id, bucket_window, bucket_start)
    DO UPDATE SET
      request_count = agent_rate_limit_counters.request_count + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING request_count INTO v_hour_count;

    IF v_hour_count > v_hour_limit THEN
      RETURN QUERY SELECT false, 0, v_hour_bucket + interval '1 hour', 'hour';
      RETURN;
    END IF;
    v_remaining := LEAST(v_remaining, v_hour_limit - v_hour_count);
  END IF;

  IF v_day_limit > 0 THEN
    INSERT INTO agent_rate_limit_counters (api_key_id, bucket_window, bucket_start, request_count, updated_at)
    VALUES (p_api_key_id, 'day', v_day_bucket, 1, v_now)
    ON CONFLICT (api_key_id, bucket_window, bucket_start)
    DO UPDATE SET
      request_count = agent_rate_limit_counters.request_count + 1,
      updated_at = EXCLUDED.updated_at
    RETURNING request_count INTO v_day_count;

    IF v_day_count > v_day_limit THEN
      RETURN QUERY SELECT false, 0, v_day_bucket + interval '1 day', 'day';
      RETURN;
    END IF;
    v_remaining := LEAST(v_remaining, v_day_limit - v_day_count);
  END IF;

  RETURN QUERY SELECT true, v_remaining, v_minute_bucket + interval '1 minute', 'minute';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT ALL ON agent_rate_limit_counters TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_and_increment_agent_rate_limit(UUID, TEXT) TO authenticated, service_role;

-- 2) Outreach draft quality telemetry (for evaluator loops and ops visibility)
ALTER TABLE outreach_drafts
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS quality_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quality_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quality_version TEXT;

CREATE INDEX IF NOT EXISTS outreach_drafts_quality_checked_at_idx
  ON outreach_drafts(quality_checked_at DESC)
  WHERE quality_checked_at IS NOT NULL;
