-- Rate limit windows table (sliding window counters)
CREATE TABLE IF NOT EXISTS rate_limit_windows (
  key          TEXT PRIMARY KEY,
  count        INT NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atomic check-and-increment function
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_key         TEXT,
  p_max         INT,
  p_window_secs INT
) RETURNS TABLE (allowed BOOLEAN, current_count INT) AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INT;
BEGIN
  SELECT rl.window_start, rl.count
    INTO v_window_start, v_count
    FROM rate_limit_windows rl
   WHERE rl.key = p_key
     FOR UPDATE;

  -- No row yet, or window expired — start fresh
  IF NOT FOUND OR now() - v_window_start > (p_window_secs || ' seconds')::INTERVAL THEN
    INSERT INTO rate_limit_windows(key, count, window_start)
    VALUES (p_key, 1, now())
    ON CONFLICT (key) DO UPDATE
      SET count = 1, window_start = now();
    RETURN QUERY SELECT TRUE, 1;
    RETURN;
  END IF;

  -- Within window — increment
  UPDATE rate_limit_windows
     SET count = count + 1
   WHERE key = p_key;

  IF v_count + 1 > p_max THEN
    RETURN QUERY SELECT FALSE, v_count + 1;
  ELSE
    RETURN QUERY SELECT TRUE, v_count + 1;
  END IF;
END;
$$ LANGUAGE plpgsql;
