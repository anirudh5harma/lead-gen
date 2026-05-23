ALTER TABLE connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_user_id_email_key;

ALTER TABLE connected_accounts
  ADD CONSTRAINT connected_accounts_user_provider_email_key
  UNIQUE (user_id, provider, email);

CREATE OR REPLACE FUNCTION enforce_connected_accounts_active_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_count INTEGER;
BEGIN
  IF NEW.is_active THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.user_id::TEXT));

    SELECT COUNT(*)
      INTO active_count
      FROM connected_accounts
      WHERE user_id = NEW.user_id
        AND is_active = TRUE
        AND id <> NEW.id;

    IF active_count >= 5 THEN
      RAISE EXCEPTION 'connected sending account limit exceeded';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connected_accounts_active_limit_trigger ON connected_accounts;

CREATE TRIGGER connected_accounts_active_limit_trigger
  BEFORE INSERT OR UPDATE OF user_id, is_active ON connected_accounts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_connected_accounts_active_limit();

CREATE INDEX IF NOT EXISTS connected_accounts_user_active_lru_idx
  ON connected_accounts(user_id, is_active, last_used_at ASC NULLS FIRST, created_at ASC);
